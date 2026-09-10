const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const {
  DEFAULT_PLATFORM_FEE_PERCENT,
  computeAddOnPricing,
} = require("./pricing.service");

/* Matches the ticket rule: an abandoned checkout releases its hold after
   thirty minutes rather than sitting on stock forever. */
const PENDING_HOLD_MS = 30 * 60 * 1000;

/* Statuses that occupy stock. A cancelled or refunded row does not. */
const HOLDING_STATUSES = ["paid", "redeemed"];

const toIdString = (value) =>
  value && typeof value === "object" && value._id
    ? String(value._id)
    : value
      ? String(value)
      : "";

const findAddOn = (event, addOnId) =>
  (event.addOns || []).find((addOn) => String(addOn._id) === String(addOnId)) ||
  null;

/**
 * How many of an add-on exist. With variants the released count lives per
 * variant, because "14 mediums left" is the number a merch desk needs; the
 * add-on's own `stock` is only used when there are none.
 */
const releasedStockFor = (addOn, variantName) => {
  if (!addOn.variants?.length) {
    return Number(addOn.stock || 0);
  }

  const variant = addOn.variants.find((item) => item.name === variantName);

  return variant ? Number(variant.stock || 0) : 0;
};

/**
 * What is already spoken for. Pending rows count only while their checkout is
 * still alive, so a dropped payment does not hold a shirt hostage.
 */
const countReservedAddOns = async ({ eventId, addOnId, variantName = "" }) => {
  const rows = await EventAddOnPurchase.aggregate([
    {
      $match: {
        eventId: new mongoose.Types.ObjectId(String(eventId)),
        addOnId: new mongoose.Types.ObjectId(String(addOnId)),
        variantName: variantName || "",
        $or: [
          { status: { $in: HOLDING_STATUSES } },
          {
            status: "pending",
            createdAt: { $gte: new Date(Date.now() - PENDING_HOLD_MS) },
          },
        ],
      },
    },
    { $group: { _id: null, quantity: { $sum: "$quantity" } } },
  ]);

  return Number(rows[0]?.quantity || 0);
};

/** Remaining per variant (or the whole add-on when it has none). */
const describeAddOnAvailability = async ({ event, addOn }) => {
  const options = addOn.variants?.length
    ? addOn.variants.map((variant) => ({
        name: variant.name,
        released: Number(variant.stock || 0),
      }))
    : [{ name: "", released: Number(addOn.stock || 0) }];

  const described = await Promise.all(
    options.map(async (option) => {
      const reserved = await countReservedAddOns({
        eventId: event._id,
        addOnId: addOn._id,
        variantName: option.name,
      });

      return {
        name: option.name,
        released: option.released,
        remaining: Math.max(0, option.released - reserved),
        soldOut: reserved >= option.released,
      };
    }),
  );

  const remaining = described.reduce((sum, item) => sum + item.remaining, 0);

  return {
    variants: addOn.variants?.length ? described : [],
    remaining,
    soldOut: remaining <= 0,
  };
};

/** Every add-on on an event, with live availability, for a buyer to browse. */
const listPublicAddOns = async ({ event }) => {
  const active = (event.addOns || []).filter((addOn) => addOn.active !== false);

  return Promise.all(
    active.map(async (addOn) => {
      const availability = await describeAddOnAvailability({ event, addOn });

      return {
        _id: String(addOn._id),
        name: addOn.name,
        description: addOn.description || "",
        priceNaira: Number(addOn.priceNaira || 0),
        redemption: addOn.redemption || "door",
        location: addOn.location || "",
        maxPerTicket: Number(addOn.maxPerTicket || 1),
        transfersOnResale: addOn.transfersOnResale !== false,
        ...availability,
      };
    }),
  );
};

/**
 * Turns what a buyer asked for into priced, stock-checked lines.
 *
 * Everything is rejected up front rather than partially accepted: a checkout
 * that silently drops the sold-out item is how someone ends up at a merch
 * desk that has never heard of them.
 */
const resolveAddOnSelection = async ({
  event,
  requested = [],
  ticketQuantity = 1,
}) => {
  if (!requested.length) {
    return [];
  }

  if (!(event.addOns || []).length) {
    throw new ApiError(400, "This event does not sell add-ons");
  }

  const seen = new Set();
  const lines = [];

  for (const item of requested) {
    const addOn = findAddOn(event, item.addOnId);

    if (!addOn || addOn.active === false) {
      throw new ApiError(400, "One of those add-ons is no longer available");
    }

    const variantName = String(item.variantName || "").trim();

    if (addOn.variants?.length && !variantName) {
      throw new ApiError(400, `Choose an option for ${addOn.name}`);
    }

    if (addOn.variants?.length) {
      const known = addOn.variants.some((variant) => variant.name === variantName);

      if (!known) {
        throw new ApiError(400, `That option is not available for ${addOn.name}`);
      }
    }

    /* One line per add-on-and-variant, so quantity is unambiguous. */
    const key = `${String(addOn._id)}:${variantName}`;

    if (seen.has(key)) {
      throw new ApiError(400, `${addOn.name} was added twice`);
    }

    seen.add(key);

    const quantity = Math.max(1, Math.round(Number(item.quantity || 1)));
    const ceiling = Math.max(1, Number(addOn.maxPerTicket || 1)) * ticketQuantity;

    if (quantity > ceiling) {
      throw new ApiError(
        400,
        `You can only add ${ceiling} ${addOn.name} to this order`,
      );
    }

    const released = releasedStockFor(addOn, variantName);
    const reserved = await countReservedAddOns({
      eventId: event._id,
      addOnId: addOn._id,
      variantName,
    });

    if (reserved + quantity > released) {
      throw new ApiError(
        409,
        variantName
          ? `${addOn.name} (${variantName}) is sold out for that quantity`
          : `${addOn.name} is sold out for that quantity`,
        null,
        "INSUFFICIENT_INVENTORY",
      );
    }

    lines.push({
      addOnId: addOn._id,
      name: addOn.name,
      variantName,
      redemption: addOn.redemption || "door",
      location: addOn.location || "",
      unitPriceNaira: Number(addOn.priceNaira || 0),
      quantity,
      transfersOnResale: addOn.transfersOnResale !== false,
      pricingBreakdown: computeAddOnPricing({
        unitPriceNaira: Number(addOn.priceNaira || 0),
        quantity,
        platformFeePercent: Number(
          event.platformFeePercent ?? DEFAULT_PLATFORM_FEE_PERCENT,
        ),
        feeMode: event.feeMode || "absorbed_by_organizer",
      }),
    });
  }

  return lines;
};

/**
 * Writes the held rows. They ride the ticket's own lifecycle: created pending
 * beside a pending ticket, flipped when the payment settles.
 */
const createAddOnPurchases = async ({
  event,
  ticket,
  buyerUserId,
  lines,
  status = "pending",
  purchaseBatchId = "",
  paymentReference = "",
}) => {
  if (!lines.length) {
    return [];
  }

  return EventAddOnPurchase.create(
    lines.map((line) => ({
      eventId: event._id,
      ticketId: ticket._id,
      buyerUserId,
      organizerUserId: event.organizerUserId,
      addOnId: line.addOnId,
      name: line.name,
      variantName: line.variantName,
      redemption: line.redemption,
      location: line.location,
      unitPriceNaira: line.unitPriceNaira,
      quantity: line.quantity,
      status,
      purchaseBatchId,
      paymentReference,
      pricingBreakdown: line.pricingBreakdown,
    })),
  );
};

const markAddOnPurchasesPaid = async ({ purchaseBatchId, paymentReference = "" }) => {
  if (!purchaseBatchId) {
    return [];
  }

  await EventAddOnPurchase.updateMany(
    { purchaseBatchId, status: "pending" },
    {
      $set: {
        status: "paid",
        ...(paymentReference ? { paymentReference } : {}),
      },
    },
  );

  return EventAddOnPurchase.find({ purchaseBatchId, status: "paid" });
};

const cancelAddOnPurchases = async ({ purchaseBatchId, reason = "" }) => {
  if (!purchaseBatchId) {
    return;
  }

  await EventAddOnPurchase.updateMany(
    { purchaseBatchId, status: "pending" },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        ...(reason ? { "pricingBreakdown.cancelReason": reason } : {}),
      },
    },
  );
};

/** What a ticket still holds, for the buyer's screen and for a door. */
const listTicketAddOns = async ({ ticketId }) =>
  EventAddOnPurchase.find({
    ticketId,
    status: { $in: ["paid", "redeemed"] },
  }).sort({ createdAt: 1 });

/**
 * Hands one add-on over. Guarded by `redeemedQuantity` rather than a boolean
 * so two shirts can be collected on separate trips, and so a second scan of
 * an already-collected item is refused rather than quietly repeated.
 */
const redeemAddOn = async ({
  purchaseId,
  actorUserId,
  quantity = 1,
  at = new Date(),
}) => {
  const purchase = await EventAddOnPurchase.findById(purchaseId);

  if (!purchase) {
    throw new ApiError(404, "That add-on is not on this ticket");
  }

  if (purchase.status === "refunded" || purchase.status === "cancelled") {
    throw new ApiError(409, `${purchase.name} was refunded and cannot be collected`);
  }

  if (purchase.status === "pending") {
    throw new ApiError(409, `${purchase.name} has not been paid for yet`);
  }

  if (purchase.redemption === "none") {
    throw new ApiError(400, `${purchase.name} is not something to hand over`);
  }

  const wanted = Math.max(1, Math.round(Number(quantity || 1)));
  const outstanding = purchase.quantity - purchase.redeemedQuantity;

  if (outstanding <= 0) {
    throw new ApiError(409, `${purchase.name} has already been collected`, {
      redeemedAt: purchase.redeemedAt,
    });
  }

  if (wanted > outstanding) {
    throw new ApiError(
      409,
      `Only ${outstanding} of ${purchase.name} is left to hand over`,
    );
  }

  /* Conditioned on the count we just read: two desks scanning the same
     ticket at once must not both succeed. */
  const updated = await EventAddOnPurchase.findOneAndUpdate(
    { _id: purchase._id, redeemedQuantity: purchase.redeemedQuantity },
    {
      $inc: { redeemedQuantity: wanted },
      $set: {
        redeemedAt: at,
        redeemedByUserId: actorUserId,
        ...(purchase.redeemedQuantity + wanted >= purchase.quantity
          ? { status: "redeemed" }
          : {}),
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, `${purchase.name} was just collected somewhere else`);
  }

  return updated;
};

/**
 * The desk's own list: who is owed what, and how much is left. Grouped by
 * add-on because that is how a table of shirts is actually worked.
 */
const summariseFulfilment = async ({ eventId, redemption = null }) => {
  const rows = await EventAddOnPurchase.aggregate([
    {
      $match: {
        eventId: new mongoose.Types.ObjectId(String(eventId)),
        status: { $in: HOLDING_STATUSES },
        ...(redemption ? { redemption } : {}),
      },
    },
    {
      $group: {
        _id: { addOnId: "$addOnId", name: "$name", variantName: "$variantName" },
        sold: { $sum: "$quantity" },
        collected: { $sum: "$redeemedQuantity" },
      },
    },
    { $sort: { "_id.name": 1, "_id.variantName": 1 } },
  ]);

  return rows.map((row) => ({
    addOnId: String(row._id.addOnId),
    name: row._id.name,
    variantName: row._id.variantName || "",
    sold: row.sold,
    collected: row.collected,
    outstanding: Math.max(0, row.sold - row.collected),
  }));
};

/**
 * The add-ons held against each of these tickets, keyed by ticket id.
 *
 * Returns the rows rather than a count: a ticket screen has to name what you
 * bought and where to collect it, and the count alone sent it back for a
 * second request. One query for the whole page either way.
 */
const listByTickets = async (ticketIds) => {
  if (!ticketIds.length) {
    return new Map();
  }

  const rows = await EventAddOnPurchase.find({
    ticketId: { $in: ticketIds },
    status: { $in: HOLDING_STATUSES },
  })
    .sort({ createdAt: 1 })
    .lean();

  const byTicket = new Map();

  for (const row of rows) {
    const key = String(row.ticketId);

    byTicket.set(key, [...(byTicket.get(key) || []), row]);
  }

  return byTicket;
};

/** The roll-up a compact row needs, derived from the same fetch. */
const summariseRows = (rows = []) => ({
  count: rows.length,
  quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
  outstanding: rows.reduce(
    (sum, row) =>
      sum + Math.max(0, Number(row.quantity || 0) - Number(row.redeemedQuantity || 0)),
    0,
  ),
});

module.exports = {
  PENDING_HOLD_MS,
  countReservedAddOns,
  describeAddOnAvailability,
  listPublicAddOns,
  resolveAddOnSelection,
  createAddOnPurchases,
  markAddOnPurchasesPaid,
  cancelAddOnPurchases,
  listTicketAddOns,
  redeemAddOn,
  summariseFulfilment,
  listByTickets,
  summariseRows,
  toIdString,
};
