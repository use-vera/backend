const mongoose = require("mongoose");
const slugify = require("slugify");
const Vendor = require("../models/vendor.model");
const VendorItem = require("../models/vendor-item.model");
const PayoutAccount = require("../models/payout-account.model");
const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const VendorOrder = require("../models/vendor-order.model");
const { NEXT_LEVEL, limitForLevel } = require("../config/vendor-limits");
const { isAdult } = require("../utils/age");
const {
  isVendorCategory,
  vendorCategoryLabel,
} = require("../constants/vendor-categories");

/**
 * Vendor profiles and menus.
 *
 * Every write here resolves the vendor from the caller's user id. No function
 * takes a vendorId from the client and trusts it: owning the account is the
 * only way to change the menu behind it.
 */

const DEFAULT_SECTION_NAME = "Menu";

const toIdString = (value) => String(value?._id || value || "");

/** Slugs collide (two "Mama Put"s), so the suffix is not decoration. */
const buildVendorSlug = (businessName) => {
  const base =
    slugify(String(businessName || ""), { lower: true, strict: true, trim: true }) ||
    "vendor";
  const suffix = Math.random().toString(36).slice(2, 7);

  return `${base}-${suffix}`;
};

const normalizeCategories = (categories) => {
  const list = Array.isArray(categories) ? categories : [];
  /* Deduped: the client sends whatever the chips were left in, and "food,
     food" would otherwise survive into everyone's filters. */
  const unique = [...new Set(list.map((value) => String(value).trim()))];
  const invalid = unique.filter((value) => !isVendorCategory(value));

  if (invalid.length > 0) {
    throw new ApiError(400, `Unknown category: ${invalid.join(", ")}`);
  }

  if (unique.length === 0) {
    throw new ApiError(400, "Pick at least one thing you sell");
  }

  return unique;
};

const mapSection = (section) => ({
  _id: toIdString(section),
  name: section.name,
  position: section.position,
});

/**
 * Whether this vendor can be paid.
 *
 * Derived from the payout account rather than stored on the vendor: a bank
 * account that is removed must not leave a vendor flagged as payable. One
 * account per user already, so the vendor's owner is the key.
 */
const payoutReadyFor = async (ownerUserIds) => {
  const rows = await PayoutAccount.find({
    organizerUserId: { $in: ownerUserIds },
  }).select("organizerUserId");

  return new Set(rows.map((row) => toIdString(row.organizerUserId)));
};

const mapVendor = (vendor, { payoutReady = false } = {}) => ({
  _id: toIdString(vendor),
  ownerUserId: toIdString(vendor.ownerUserId),
  businessName: vendor.businessName,
  slug: vendor.slug,
  logoUrl: vendor.logoUrl || "",
  categories: vendor.categories || [],
  categoryLabels: (vendor.categories || []).map(vendorCategoryLabel),
  city: vendor.city || "",
  contactPhone: vendor.contactPhone || "",
  sections: [...(vendor.sections || [])]
    .sort((left, right) => left.position - right.position)
    .map(mapSection),
  verificationLevel: vendor.verificationLevel,
  verification: {
    status: vendor.verification?.status || "none",
    bvnLast4: vendor.verification?.bvnLast4 || "",
    cacNumber: vendor.verification?.cacNumber || "",
    reviewNote: vendor.verification?.reviewNote || "",
    submittedAt: vendor.verification?.submittedAt || null,
  },
  payoutReady,
  status: vendor.status,
  averageRating: vendor.averageRating || 0,
  ratingsCount: vendor.ratingsCount || 0,
  eventsWorkedCount: vendor.eventsWorkedCount || 0,
  createdAt: vendor.createdAt,
});

const mapItem = (item) => ({
  _id: toIdString(item),
  vendorId: toIdString(item.vendorId),
  name: item.name,
  description: item.description || "",
  imageUrl: item.imageUrl || "",
  priceNaira: item.priceNaira,
  category: item.category,
  categoryLabel: vendorCategoryLabel(item.category),
  sectionId: item.sectionId ? toIdString(item.sectionId) : null,
  position: item.position,
  available: Boolean(item.available),
  ageRestricted: Boolean(item.ageRestricted),
  stock: item.stock === null || item.stock === undefined ? null : item.stock,
});

/** One vendor, with its derived flags filled in. */
const presentVendor = async (vendor) => {
  const ready = await payoutReadyFor([toIdString(vendor.ownerUserId)]);

  return mapVendor(vendor, {
    payoutReady: ready.has(toIdString(vendor.ownerUserId)),
  });
};

/**
 * The caller's own vendor. Everything that writes goes through here, so
 * ownership is checked in exactly one place.
 */
const requireOwnVendor = async (actorUserId) => {
  const vendor = await Vendor.findOne({ ownerUserId: actorUserId });

  if (!vendor) {
    throw new ApiError(404, "You do not have a vendor account yet", null, "VENDOR_NOT_FOUND");
  }

  if (vendor.status === "suspended") {
    throw new ApiError(403, "This vendor account is suspended");
  }

  return vendor;
};

const getMyVendor = async ({ actorUserId }) => {
  const vendor = await Vendor.findOne({ ownerUserId: actorUserId });

  if (!vendor) {
    /* Not an error: the merchant sign-up asks for this before the profile
       exists, to decide between "create yours" and "here is your workspace". */
    return null;
  }

  return presentVendor(vendor);
};

const createVendor = async ({ actorUserId, payload }) => {
  const existing = await Vendor.findOne({ ownerUserId: actorUserId });

  if (existing) {
    throw new ApiError(
      409,
      "You already have a vendor account",
      { vendorId: toIdString(existing) },
      "VENDOR_ALREADY_EXISTS",
    );
  }

  const businessName = String(payload.businessName || "").trim();

  if (!businessName) {
    throw new ApiError(400, "Your business needs a name");
  }

  const vendor = await Vendor.create({
    ownerUserId: actorUserId,
    businessName,
    slug: buildVendorSlug(businessName),
    logoUrl: String(payload.logoUrl || "").trim(),
    categories: normalizeCategories(payload.categories),
    city: String(payload.city || "").trim(),
    contactPhone: String(payload.contactPhone || "").trim(),
  });

  return presentVendor(vendor);
};

const updateVendor = async ({ actorUserId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);

  if (payload.businessName !== undefined) {
    const businessName = String(payload.businessName).trim();

    if (!businessName) {
      throw new ApiError(400, "Your business needs a name");
    }

    /* The slug deliberately does not follow a rename: links already shared
       with organizers keep working. */
    vendor.businessName = businessName;
  }

  if (payload.categories !== undefined) {
    vendor.categories = normalizeCategories(payload.categories);
  }

  if (payload.logoUrl !== undefined) {
    vendor.logoUrl = String(payload.logoUrl).trim();
  }

  if (payload.city !== undefined) {
    vendor.city = String(payload.city).trim();
  }

  if (payload.contactPhone !== undefined) {
    vendor.contactPhone = String(payload.contactPhone).trim();
  }

  await vendor.save();

  return presentVendor(vendor);
};

/**
 * Where a vendor stands against their ceiling, and what lifts it.
 *
 * Read from the orders rather than a counter, so it cannot drift from what
 * the sales-limit check in vendor-order.service.js actually enforces.
 */
const getMyLimits = async ({ actorUserId }) => {
  const vendor = await requireOwnVendor(actorUserId);

  const [summary] = await VendorOrder.aggregate([
    {
      $match: {
        vendorId: vendor._id,
        status: { $in: ["paid", "preparing", "ready", "collected"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$pricing.subtotalNaira" } } },
  ]);

  const limitNaira = limitForLevel(vendor.verificationLevel);
  const soldNaira = Number(summary?.total || 0);

  return {
    verificationLevel: vendor.verificationLevel,
    verification: mapVendor(vendor).verification,
    soldNaira,
    limitNaira,
    remainingNaira: limitNaira === null ? null : Math.max(0, limitNaira - soldNaira),
    next: NEXT_LEVEL[vendor.verificationLevel] || null,
  };
};

/**
 * Submits the one thing the next level asks for.
 *
 * A BVN is checked by a provider and never kept: only the last four digits
 * stay, so a vendor can tell which number they used. Nothing here grants a
 * level by itself — that is a decision, made in reviewVendorVerification.
 */
const submitVerification = async ({ actorUserId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);

  if (payload.cacNumber) {
    const cacNumber = String(payload.cacNumber).trim();

    vendor.verification = {
      ...(vendor.verification?.toObject?.() || vendor.verification || {}),
      status: "pending",
      cacNumber,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewNote: "",
    };

    await vendor.save();

    return mapVendor(vendor);
  }

  const bvn = String(payload.bvn || "").replace(/\D/g, "");

  if (bvn.length !== 11) {
    throw new ApiError(400, "A BVN is 11 digits");
  }

  /* The date of birth is half of the check, so it has to be on the account
     before the check can run at all. */
  const owner = await User.findById(vendor.ownerUserId).select("dateOfBirth");

  if (!owner?.dateOfBirth) {
    throw new ApiError(
      400,
      "Add your date of birth to your profile first",
      null,
      "DATE_OF_BIRTH_REQUIRED",
    );
  }

  if (!isAdult(owner.dateOfBirth)) {
    throw new ApiError(403, "You must be 18 or older to be verified");
  }

  vendor.verification = {
    ...(vendor.verification?.toObject?.() || vendor.verification || {}),
    status: "pending",
    bvnLast4: bvn.slice(-4),
    submittedAt: new Date(),
    reviewedAt: null,
    reviewNote: "",
  };

  await vendor.save();

  return mapVendor(vendor);
};

/**
 * The decision itself: an admin approves or refuses a submission.
 *
 * Separate from the submission on purpose. Until an identity provider is
 * wired in, a person makes this call, and when one is wired in it calls this
 * same function rather than growing a second path to the same state.
 */
const reviewVendorVerification = async ({ vendorId, approve, level, note }) => {
  const vendor = await Vendor.findById(vendorId);

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  if (vendor.verification?.status !== "pending") {
    throw new ApiError(409, "That vendor has nothing waiting for review");
  }

  const nextLevel = level || (vendor.verification?.cacNumber ? "registered" : "verified");

  if (approve && !["verified", "registered"].includes(nextLevel)) {
    throw new ApiError(400, "Unknown verification level");
  }

  vendor.verification.status = approve ? "verified" : "rejected";
  vendor.verification.reviewedAt = new Date();
  vendor.verification.reviewNote = String(note || "").trim();

  if (approve) {
    vendor.verificationLevel = nextLevel;
  }

  await vendor.save();

  return mapVendor(vendor);
};

/** Admin: stop a vendor selling, or let them start again. */
const setVendorStatus = async ({ vendorId, status, note }) => {
  if (!["active", "suspended"].includes(status)) {
    throw new ApiError(400, "Unknown status");
  }

  const vendor = await Vendor.findById(vendorId);

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  vendor.status = status;

  if (note) {
    vendor.verification.reviewNote = String(note).trim();
  }

  await vendor.save();

  return mapVendor(vendor);
};

/* ---------------------------------------------------------------- sections */

const addSection = async ({ actorUserId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const name = String(payload.name || "").trim();

  if (!name) {
    throw new ApiError(400, "A section needs a name");
  }

  const clash = vendor.sections.some(
    (section) => section.name.toLowerCase() === name.toLowerCase(),
  );

  if (clash) {
    throw new ApiError(409, `You already have a section called ${name}`);
  }

  const position = vendor.sections.length
    ? Math.max(...vendor.sections.map((section) => section.position)) + 1
    : 0;

  vendor.sections.push({ name, position });
  await vendor.save();

  return presentVendor(vendor);
};

const renameSection = async ({ actorUserId, sectionId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const section = vendor.sections.id(sectionId);

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  const name = String(payload.name || "").trim();

  if (!name) {
    throw new ApiError(400, "A section needs a name");
  }

  section.name = name;
  await vendor.save();

  return presentVendor(vendor);
};

/**
 * Deleting a section keeps its items: they fall back to the default heading.
 * Taking a heading away should never quietly delete a vendor's work.
 */
const deleteSection = async ({ actorUserId, sectionId }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const section = vendor.sections.id(sectionId);

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  await VendorItem.updateMany(
    { vendorId: vendor._id, sectionId: section._id },
    { $set: { sectionId: null } },
  );

  section.deleteOne();
  await vendor.save();

  return presentVendor(vendor);
};

const reorderSections = async ({ actorUserId, sectionIds }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const known = new Set(vendor.sections.map((section) => toIdString(section)));
  const incoming = sectionIds.map(String);

  /* A partial order would leave the rest at whatever position they held,
     which is how menus end up in an order nobody chose. */
  if (incoming.length !== known.size || incoming.some((id) => !known.has(id))) {
    throw new ApiError(400, "Send every section id, in the order you want");
  }

  incoming.forEach((id, index) => {
    vendor.sections.id(id).position = index;
  });

  await vendor.save();

  return presentVendor(vendor);
};

/* ------------------------------------------------------------------- items */

const resolveSectionId = (vendor, sectionId) => {
  if (sectionId === undefined || sectionId === null || sectionId === "") {
    return null;
  }

  if (!vendor.sections.id(sectionId)) {
    throw new ApiError(400, "That section does not exist on your menu");
  }

  return new mongoose.Types.ObjectId(String(sectionId));
};

const normalizePrice = (value) => {
  const price = Math.round(Number(value));

  if (!Number.isFinite(price) || price < 0) {
    throw new ApiError(400, "A price cannot be negative");
  }

  return price;
};

const normalizeStock = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const stock = Math.round(Number(value));

  if (!Number.isFinite(stock) || stock < 0) {
    throw new ApiError(400, "Stock cannot be negative");
  }

  return stock;
};

const createItem = async ({ actorUserId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const name = String(payload.name || "").trim();

  if (!name) {
    throw new ApiError(400, "An item needs a name");
  }

  if (!isVendorCategory(payload.category)) {
    throw new ApiError(400, "Pick a category for this item");
  }

  const sectionId = resolveSectionId(vendor, payload.sectionId);
  const siblings = await VendorItem.countDocuments({
    vendorId: vendor._id,
    sectionId,
  });

  const item = await VendorItem.create({
    vendorId: vendor._id,
    name,
    description: String(payload.description || "").trim(),
    imageUrl: String(payload.imageUrl || "").trim(),
    priceNaira: normalizePrice(payload.priceNaira),
    category: String(payload.category),
    sectionId,
    position: siblings,
    available: payload.available === undefined ? true : Boolean(payload.available),
    ageRestricted: Boolean(payload.ageRestricted),
    stock: normalizeStock(payload.stock),
  });

  return mapItem(item);
};

/** Every item write re-reads the item scoped to the caller's own vendor. */
const requireOwnItem = async (vendor, itemId) => {
  const item = await VendorItem.findOne({ _id: itemId, vendorId: vendor._id });

  if (!item) {
    throw new ApiError(404, "Item not found");
  }

  return item;
};

const updateItem = async ({ actorUserId, itemId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const item = await requireOwnItem(vendor, itemId);

  if (payload.name !== undefined) {
    const name = String(payload.name).trim();

    if (!name) {
      throw new ApiError(400, "An item needs a name");
    }

    item.name = name;
  }

  if (payload.description !== undefined) {
    item.description = String(payload.description).trim();
  }

  if (payload.imageUrl !== undefined) {
    item.imageUrl = String(payload.imageUrl).trim();
  }

  if (payload.priceNaira !== undefined) {
    item.priceNaira = normalizePrice(payload.priceNaira);
  }

  if (payload.category !== undefined) {
    if (!isVendorCategory(payload.category)) {
      throw new ApiError(400, "Pick a category for this item");
    }

    item.category = String(payload.category);
  }

  if (payload.sectionId !== undefined) {
    item.sectionId = resolveSectionId(vendor, payload.sectionId);
  }

  if (payload.available !== undefined) {
    item.available = Boolean(payload.available);
  }

  if (payload.ageRestricted !== undefined) {
    item.ageRestricted = Boolean(payload.ageRestricted);
  }

  if (payload.stock !== undefined) {
    item.stock = normalizeStock(payload.stock);
  }

  await item.save();

  return mapItem(item);
};

const deleteItem = async ({ actorUserId, itemId }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const item = await requireOwnItem(vendor, itemId);

  await item.deleteOne();

  return { _id: toIdString(item), deleted: true };
};

const reorderItems = async ({ actorUserId, itemIds }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const items = await VendorItem.find({
    _id: { $in: itemIds },
    vendorId: vendor._id,
  });

  if (items.length !== itemIds.length) {
    throw new ApiError(400, "Those items are not all on your menu");
  }

  await Promise.all(
    itemIds.map((id, index) =>
      VendorItem.updateOne(
        { _id: id, vendorId: vendor._id },
        { $set: { position: index } },
      ),
    ),
  );

  return { reordered: itemIds.length };
};

/**
 * A whole menu, grouped the way it is shown.
 *
 * `forBuyers` drops what is not on sale, so the attendee-facing call cannot
 * leak an item the vendor switched off. Sold-out items stay visible to the
 * vendor themselves: that is how they switch them back on.
 */
const buildMenu = async ({ vendor, forBuyers = false }) => {
  const query = { vendorId: vendor._id };

  if (forBuyers) {
    query.available = true;
  }

  const items = await VendorItem.find(query).sort({ position: 1, createdAt: 1 });
  const sections = [...vendor.sections]
    .sort((left, right) => left.position - right.position)
    .map((section) => ({
      _id: toIdString(section),
      name: section.name,
      items: [],
    }));

  const fallback = { _id: null, name: DEFAULT_SECTION_NAME, items: [] };
  const byId = new Map(sections.map((section) => [section._id, section]));

  for (const item of items) {
    const key = item.sectionId ? toIdString(item.sectionId) : null;
    const bucket = (key && byId.get(key)) || fallback;

    bucket.items.push(mapItem(item));
  }

  const grouped = [...(fallback.items.length ? [fallback] : []), ...sections];

  return {
    vendor: await presentVendor(vendor),
    /* Empty sections are kept for the vendor (they are about to fill them)
       and dropped for buyers (an empty heading is noise). */
    sections: forBuyers
      ? grouped.filter((section) => section.items.length > 0)
      : grouped,
    itemCount: items.length,
  };
};

const getMyMenu = async ({ actorUserId }) => {
  const vendor = await requireOwnVendor(actorUserId);

  return buildMenu({ vendor, forBuyers: false });
};

const getPublicVendorMenu = async ({ slug }) => {
  const vendor = await Vendor.findOne({ slug: String(slug), status: "active" });

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  return buildMenu({ vendor, forBuyers: true });
};

/**
 * Vendor search, for organizers picking who to invite.
 *
 * Suspended vendors are never listed, and nothing user-scoped is returned:
 * this is a directory, not a profile.
 */
const listVendors = async ({ search, category, city, page = 1, limit = 20 }) => {
  const query = { status: "active" };

  if (category) {
    if (!isVendorCategory(category)) {
      throw new ApiError(400, "Unknown category");
    }

    query.categories = category;
  }

  if (city) {
    query.city = new RegExp(`^${String(city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    query.businessName = new RegExp(
      trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);

  const [rows, totalItems] = await Promise.all([
    Vendor.find(query)
      .sort({ averageRating: -1, eventsWorkedCount: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Vendor.countDocuments(query),
  ]);

  const ready = await payoutReadyFor(rows.map((row) => toIdString(row.ownerUserId)));

  return {
    items: rows.map((row) =>
      mapVendor(row, { payoutReady: ready.has(toIdString(row.ownerUserId)) }),
    ),
    page: safePage,
    limit: safeLimit,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / safeLimit),
  };
};

module.exports = {
  DEFAULT_SECTION_NAME,
  addSection,
  createItem,
  createVendor,
  deleteItem,
  deleteSection,
  getMyLimits,
  getMyMenu,
  getMyVendor,
  getPublicVendorMenu,
  listVendors,
  renameSection,
  reorderItems,
  reorderSections,
  reviewVendorVerification,
  setVendorStatus,
  submitVerification,
  updateItem,
  updateVendor,
};
