const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const TicketHold = require("../models/ticket-hold.model");

/* Lazy: event.service is large and requires much of the app. */
const events = () => require("./event.service");

const HOLD_MS = 10 * 60 * 1000;
const MAX_ACTIVE_HOLDS = 2;
const MAX_HOLD_QUANTITY = 4;

const toIdString = (value) => String(value?._id || value || "");
const activeFor = (now) => ({ status: "active", expiresAt: { $gt: now } });

/* Resale listings are priced as a whole; watches and holds compare per ticket. */
const perTicketResalePrice = (ticket) =>
  Math.round(Number(ticket.resalePriceNaira || 0) / Math.max(1, Number(ticket.resaleQuantity || ticket.quantity || 1)));

const enforceHoldLimit = async ({ userId, now, exceptEventId = null }) => {
  const active = await TicketHold.countDocuments({
    userId,
    ...activeFor(now),
    ...(exceptEventId ? { eventId: { $ne: exceptEventId } } : {}),
  });
  if (active >= MAX_ACTIVE_HOLDS) {
    throw new ApiError(409, `You can hold tickets for ${MAX_ACTIVE_HOLDS} events at a time. Let one go first.`, null, "HOLD_LIMIT");
  }
};

/**
 * Sets tickets aside for 10 minutes. Nothing is charged; the holder buys
 * them the usual way, and anyone else sees them as taken until the hold
 * runs out. Holding again for the same event replaces the earlier hold.
 */
const createPrimaryHold = async ({ userId, eventId, ticketCategoryId = null, quantity = 1, source = "vera", now = new Date() }) => {
  const event = await Event.findById(eventId);
  if (!event || event.status !== "published") {
    throw new ApiError(404, "That event isn't available.");
  }

  const access = events().resolveTicketSalesAccess(event, now);
  if (!access.canPurchase) {
    throw new ApiError(409, access.reason || "Tickets aren't on sale right now.", null, "NOT_ON_SALE");
  }
  if (access.phase === "presale") {
    throw new ApiError(409, "Holds open once the main sale starts.", null, "NOT_ON_SALE");
  }

  const categories = Array.isArray(event.ticketCategories) ? event.ticketCategories : [];
  const category = categories.length
    ? categories.find((tier) => toIdString(tier._id) === String(ticketCategoryId || "")) || (categories.length === 1 ? categories[0] : null)
    : null;
  if (categories.length && !category) {
    throw new ApiError(400, "Pick a ticket type to hold.", null, "CATEGORY_REQUIRED");
  }
  if (category) {
    const availability = events().resolveTicketCategoryAvailability(category, now);
    if (!availability.onSale) throw new ApiError(409, availability.reason, null, "NOT_ON_SALE");
  }

  const count = Math.min(MAX_HOLD_QUANTITY, Math.max(1, Math.round(Number(quantity) || 1)));
  await enforceHoldLimit({ userId, now, exceptEventId: event._id });

  /* Their own earlier hold for this event is about to be replaced, so it doesn't count against them. */
  const reserved = await events().countReservedTickets(event._id, category ? category._id : null, null, userId);
  const capacity = Number(category ? category.quantity : event.expectedTickets) || 0;
  if (reserved + count > capacity) {
    throw new ApiError(409, count > 1 ? `There aren't ${count} tickets left to hold.` : "There are no tickets left to hold.", null, "SOLD_OUT");
  }

  await TicketHold.updateMany({ userId, eventId: event._id, kind: "primary", ...activeFor(now) }, { $set: { status: "released" } });
  const hold = await TicketHold.create({
    userId,
    kind: "primary",
    eventId: event._id,
    ticketCategoryId: category ? category._id : null,
    quantity: count,
    source,
    expiresAt: new Date(now.getTime() + HOLD_MS),
  });
  return presentHold(hold.toObject(), event, category);
};

/** Keeps one resale listing for this person for 10 minutes; nobody else can start buying it meanwhile. */
const createResaleHold = async ({ userId, resaleTicketId, source = "vera", now = new Date() }) => {
  const ticket = await EventTicket.findById(resaleTicketId);
  if (!ticket || ticket.resaleStatus !== "listed" || ticket.status !== "paid") {
    throw new ApiError(404, "That resale ticket isn't available any more.", null, "NOT_AVAILABLE");
  }
  if (toIdString(ticket.buyerUserId) === String(userId)) {
    throw new ApiError(400, "That's your own listing.");
  }

  const held = await TicketHold.findOne({ kind: "resale", resaleTicketId: ticket._id, ...activeFor(now) });
  if (held && toIdString(held.userId) !== String(userId)) {
    throw new ApiError(409, "Someone else is holding that ticket for a few minutes.", null, "TICKET_HELD");
  }

  const event = await Event.findById(ticket.eventId);
  if (held) return presentHold(held.toObject(), event, null, ticket);

  await enforceHoldLimit({ userId, now, exceptEventId: ticket.eventId });
  const hold = await TicketHold.create({
    userId,
    kind: "resale",
    eventId: ticket.eventId,
    resaleTicketId: ticket._id,
    quantity: Math.max(1, Number(ticket.resaleQuantity || ticket.quantity || 1)),
    source,
    expiresAt: new Date(now.getTime() + HOLD_MS),
  });
  return presentHold(hold.toObject(), event, null, ticket);
};

const releaseHold = async ({ userId, holdId, now = new Date() }) => {
  const released = await TicketHold.findOneAndUpdate(
    { _id: holdId, userId, ...activeFor(now) },
    { $set: { status: "released" } },
    { new: true },
  );
  if (!released) throw new ApiError(404, "That hold has already ended.");
  return { released: true };
};

const presentHold = (hold, event, category = null, resaleTicket = null) => ({
  _id: toIdString(hold._id),
  kind: hold.kind,
  eventId: toIdString(hold.eventId),
  eventName: event?.name || "",
  imageUrl: event?.imageUrl || "",
  startsAt: event?.startsAt || null,
  quantity: hold.quantity,
  ticketCategoryId: hold.ticketCategoryId ? toIdString(hold.ticketCategoryId) : null,
  ticketCategoryName: category?.name || "",
  resaleTicketId: hold.resaleTicketId ? toIdString(hold.resaleTicketId) : null,
  resalePriceNaira: resaleTicket ? perTicketResalePrice(resaleTicket) : null,
  source: hold.source,
  expiresAt: hold.expiresAt,
});

const listMyHolds = async ({ userId, now = new Date() }) => {
  const holds = await TicketHold.find({ userId: new mongoose.Types.ObjectId(String(userId)), ...activeFor(now) })
    .sort({ expiresAt: 1 })
    .lean();
  const [eventRows, resaleRows] = await Promise.all([
    Event.find({ _id: { $in: holds.map((hold) => hold.eventId) } }).select("name imageUrl startsAt ticketCategories").lean(),
    EventTicket.find({ _id: { $in: holds.map((hold) => hold.resaleTicketId).filter(Boolean) } })
      .select("resalePriceNaira resaleQuantity quantity")
      .lean(),
  ]);
  const eventById = new Map(eventRows.map((event) => [toIdString(event._id), event]));
  const resaleById = new Map(resaleRows.map((ticket) => [toIdString(ticket._id), ticket]));

  return {
    items: holds.map((hold) => {
      const event = eventById.get(toIdString(hold.eventId));
      const category = (event?.ticketCategories || []).find((tier) => toIdString(tier._id) === toIdString(hold.ticketCategoryId));
      return presentHold(hold, event, category, hold.resaleTicketId ? resaleById.get(toIdString(hold.resaleTicketId)) : null);
    }),
  };
};

module.exports = {
  HOLD_MS,
  MAX_ACTIVE_HOLDS,
  createPrimaryHold,
  createResaleHold,
  releaseHold,
  listMyHolds,
  perTicketResalePrice,
};
