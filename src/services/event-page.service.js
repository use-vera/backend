const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventPage = require("../models/event-page.model");
const EventTicket = require("../models/event-ticket.model");
const { getPublicEventById } = require("./event.service");

/**
 * Slugs the app's own routes already answer to. A page must never be able to
 * take one, or `vera.tickets/events` would stop being the events list. This is
 * enforced at write time rather than at render, so a collision is impossible
 * rather than merely unlikely.
 */
const RESERVED_SLUGS = new Set([
  "about", "account", "admin", "api", "auth", "blog", "checkout", "contact",
  "developers", "download", "events", "faq", "for-organizers", "help",
  "how-it-works", "legal", "login", "logout", "organizer", "p", "press",
  "pricing", "privacy", "register", "resale", "search", "settings", "signin",
  "signup", "support", "terms", "tickets", "vera", "www",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const toSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const assertSlugUsable = async (slug, { exceptPageId = null } = {}) => {
  if (!SLUG_PATTERN.test(slug)) {
    throw new ApiError(
      400,
      "Use lowercase letters, numbers and hyphens only",
      null,
      "SLUG_INVALID",
    );
  }

  if (slug.length < 3) {
    throw new ApiError(400, "That address is too short", null, "SLUG_INVALID");
  }

  if (RESERVED_SLUGS.has(slug)) {
    throw new ApiError(409, "That address is reserved", null, "SLUG_RESERVED");
  }

  // A slug is taken if it is any page's current slug OR one it used to answer
  // to. Old links must keep resolving to the page that owned them.
  const clash = await EventPage.findOne({
    $or: [{ slug }, { previousSlugs: slug }],
    ...(exceptPageId ? { _id: { $ne: exceptPageId } } : {}),
  })
    .select("_id")
    .lean();

  if (clash) {
    throw new ApiError(409, "That address is taken", null, "SLUG_TAKEN");
  }
};

const ensureOwnedEvent = async (eventId, actorUserId) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (String(event.organizerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "Only the event creator can edit its page");
  }

  return event;
};

/** A first page that already says something, rather than a blank canvas. */
const starterBlocks = (event) => [
  {
    id: "hero",
    type: "hero",
    props: {
      eyebrow: "",
      headline: event.name,
      body: "",
      ctaLabel: "Get tickets",
      imageUrl: event.imageUrl || "",
    },
  },
  {
    id: "about",
    type: "text",
    props: {
      heading: "About this event",
      body: event.description || "",
    },
  },
  { id: "tickets", type: "tickets", props: { heading: "Tickets", layout: "list", showSoldOut: true, showRemaining: true } },
  { id: "venue", type: "venue", props: { heading: "Getting there", showMap: true } },
  { id: "footer", type: "footer", props: {} },
];

const getEventPage = async ({ eventId, actorUserId }) => {
  const event = await ensureOwnedEvent(eventId, actorUserId);
  const page = await EventPage.findOne({ eventId: event._id });

  if (page) {
    page.theme = normaliseTheme(page.theme);
  }

  return {
    page,
    suggestedSlug: toSlug(event.name),
    starterBlocks: page ? null : starterBlocks(event),
  };
};

const checkSlug = async ({ slug, eventId, actorUserId }) => {
  await ensureOwnedEvent(eventId, actorUserId);

  const normalised = toSlug(slug);
  const existing = await EventPage.findOne({ eventId }).select("_id").lean();

  try {
    await assertSlugUsable(normalised, { exceptPageId: existing?._id ?? null });
  } catch (error) {
    return { slug: normalised, available: false, reason: error.message };
  }

  return { slug: normalised, available: true, reason: "" };
};

/**
 * Create-or-update in one call. A builder saves constantly, and splitting it
 * would mean the client tracking whether a page exists yet.
 */
/**
 * Fonts used to be one family each. They are pairings now, so a page saved
 * before that carries a name the schema no longer knows, and every save of it
 * failed validation until the value was translated.
 */
const LEGACY_FONTS = { serif: "classic", grotesk: "modern" };

const normaliseTheme = (theme) => {
  if (!theme) {
    return theme;
  }

  const plain = theme.toObject?.() ?? theme;

  return LEGACY_FONTS[plain.font]
    ? { ...plain, font: LEGACY_FONTS[plain.font] }
    : plain;
};

const saveEventPage = async ({ eventId, actorUserId, payload }) => {
  const event = await ensureOwnedEvent(eventId, actorUserId);
  let page = await EventPage.findOne({ eventId: event._id });

  const requestedSlug = payload.slug ? toSlug(payload.slug) : null;

  if (!page) {
    const slug = requestedSlug || toSlug(event.name) || `event-${String(event._id).slice(-6)}`;
    await assertSlugUsable(slug);

    page = new EventPage({
      eventId: event._id,
      organizerUserId: event.organizerUserId,
      slug,
      blocks: payload.blocks ?? starterBlocks(event),
      theme: normaliseTheme(payload.theme) ?? {},
      seo: payload.seo ?? {},
    });
  } else {
    if (requestedSlug && requestedSlug !== page.slug) {
      await assertSlugUsable(requestedSlug, { exceptPageId: page._id });

      // Keep answering to the old address. Posters and shared links outlive
      // an organizer changing their mind.
      if (!page.previousSlugs.includes(page.slug)) {
        page.previousSlugs.push(page.slug);
      }

      page.slug = requestedSlug;
    }

    if (payload.blocks) {
      page.blocks = payload.blocks;
    }

    /* Runs whether or not the payload touched the theme: a legacy font
       already on the document would fail the model's enum on any save. */
    page.theme = normaliseTheme({
      ...(page.theme?.toObject?.() ?? page.theme),
      ...(payload.theme ?? {}),
    });

    if (payload.seo) {
      page.seo = { ...page.seo.toObject?.() ?? page.seo, ...payload.seo };
    }
  }

  await page.save();

  return page;
};

const setEventPageStatus = async ({ eventId, actorUserId, status }) => {
  const event = await ensureOwnedEvent(eventId, actorUserId);
  const page = await EventPage.findOne({ eventId: event._id });

  if (!page) {
    throw new ApiError(404, "This event has no page yet");
  }

  page.status = status;
  page.publishedAt = status === "published" ? new Date() : page.publishedAt;
  await page.save();

  return page;
};

/**
 * The public read, by slug. No auth. This is the front door.
 *
 * Bound blocks are resolved here rather than on the client so a crawler and a
 * browser see the same page, and so the client never has to know which block
 * types read live data.
 */
/**
 * What the resale block needs to say something true: how many tickets are
 * actually on the marketplace right now and the cheapest of them.
 *
 * Mirrors the marketplace's own public filter. A listed ticket on a paid
 * order. An accepted offer is held for its buyer and is not for sale.
 */
const summariseResale = async (event) => {
  if (!event?.resale?.enabled) {
    return { enabled: false, listingCount: 0, fromPriceNaira: null };
  }

  const [summary] = await EventTicket.aggregate([
    { $match: { eventId: event._id, status: "paid", resaleStatus: "listed" } },
    {
      $group: {
        _id: null,
        listingCount: { $sum: 1 },
        fromPriceNaira: { $min: "$resalePriceNaira" },
      },
    },
  ]);

  return {
    enabled: true,
    listingCount: summary?.listingCount ?? 0,
    fromPriceNaira: summary?.fromPriceNaira ?? null,
  };
};

const getPublicEventPage = async ({ slug }) => {
  const normalised = toSlug(slug);

  const page = await EventPage.findOne({
    $or: [{ slug: normalised }, { previousSlugs: normalised }],
    status: "published",
  });

  if (!page || !page.eventId) {
    throw new ApiError(404, "Page not found");
  }

  /* Built through the public event endpoint's own assembly rather than read
     off the raw document, so a landing page sees the same event the app does:
     the resolved occurrence, live per-tier availability, dynamic pricing.
     Reading the document directly handed blocks an event with no
     nextOccurrenceAt, which crashed the hero's date formatter. */
  let event;
  let ratings;

  try {
    ({ event, ratings } = await getPublicEventById({ eventId: page.eventId }));
  } catch (error) {
    /* It also enforces "published only". An event pulled down must take its
       landing page with it, and as a 404 for the page, not for the event. */
    if (error instanceof ApiError && error.statusCode === 404) {
      throw new ApiError(404, "Page not found");
    }

    throw error;
  }

  return {
    // Tells the client to correct the address without breaking the old link.
    canonicalSlug: page.slug,
    redirected: page.slug !== normalised,
    theme: normaliseTheme(page.theme),
    seo: page.seo,
    blocks: page.blocks,
    event,
    /* The reviews block shows what past attendees actually wrote, not just a
       star average. This already comes back from the event lookup. */
    ratings,
    resale: await summariseResale(event),
  };
};

module.exports = {
  getEventPage,
  saveEventPage,
  setEventPageStatus,
  checkSlug,
  getPublicEventPage,
  toSlug,
  RESERVED_SLUGS,
};
