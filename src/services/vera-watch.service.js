const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventWaitlistEntry = require("../models/event-waitlist-entry.model");
const User = require("../models/user.model");
const VeraWatch = require("../models/vera-watch.model");
const { createNotification } = require("./notification.service");
const holds = require("./ticket-hold.service");

const MAX_ACTIVE_WATCHES = 10;
const PRICE_HISTORY = 20;

const toIdString = (value) => String(value?._id || value || "");
const naira = (amount) => `₦${Math.round(Number(amount) || 0).toLocaleString("en-NG")}`;
const hostName = (user) => user?.fullName || "this host";

const notify = (payload) => createNotification({ push: true, ...payload }).catch(() => null);

/* ---------- Creating and changing ---------- */

/**
 * A new watch, or the existing one for the same thing with its line and
 * action updated, so asking twice never doubles the alerts.
 */
const createWatch = async ({ userId, kind, eventId, maxPriceNaira, action = "notify", now = new Date() }) => {
  const event = eventId ? await Event.findById(eventId).populate("organizerUserId", "fullName") : null;
  if (!event || event.status !== "published") {
    throw new ApiError(404, "That event isn't available to watch.");
  }

  let filter;
  let fields;
  if (kind === "resale_price") {
    if (!event.resale?.enabled) {
      throw new ApiError(409, "This event doesn't allow resale, so there's nothing to watch.", null, "RESALE_OFF");
    }
    const line = Math.round(Number(maxPriceNaira) || 0);
    if (line <= 0) throw new ApiError(400, "Set the most you'd pay for a ticket.");
    filter = { userId, kind, eventId: event._id };
    fields = { maxPriceNaira: line, label: `Tell me if a ${event.name} resale drops under ${naira(line)}` };
  } else {
    if (!event.organizerUserId) throw new ApiError(409, "We don't know who hosts that event.");
    filter = { userId, kind, organizerUserId: event.organizerUserId._id };
    fields = { eventId: event._id, label: `Tell me when ${hostName(event.organizerUserId)} announces their next event` };
  }

  const existing = await VeraWatch.findOne({ ...filter, status: { $ne: "stopped" } });
  if (!existing) {
    const active = await VeraWatch.countDocuments({ userId, status: "watching" });
    if (active >= MAX_ACTIVE_WATCHES) {
      throw new ApiError(409, `Vera can watch ${MAX_ACTIVE_WATCHES} things at once. Stop one first.`, null, "WATCH_LIMIT");
    }
  }

  const watch = await VeraWatch.findOneAndUpdate(
    { ...filter, status: { $ne: "stopped" } },
    {
      $set: { ...fields, action: action === "hold" ? "hold" : "notify", status: "watching", triggeredAt: null, triggerEventId: null, holdId: null },
      $setOnInsert: filter,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  /* A resale may already be under the line: check now rather than at the next tick. */
  await checkWatch(watch, now);
  return presentWatch(await VeraWatch.findById(watch._id).lean());
};

const updateWatch = async ({ userId, watchId, patch }) => {
  const $set = {};
  if (patch.action === "notify" || patch.action === "hold") $set.action = patch.action;
  if (patch.status === "watching") Object.assign($set, { status: "watching", triggeredAt: null, triggerEventId: null, holdId: null });
  const watch = await VeraWatch.findOneAndUpdate({ _id: watchId, userId, status: { $ne: "stopped" } }, { $set }, { new: true }).lean();
  if (!watch) throw new ApiError(404, "That watch has ended.");
  return presentWatch(watch);
};

const stopWatch = async ({ userId, watchId }) => {
  const watch = await VeraWatch.findOneAndUpdate({ _id: watchId, userId, status: { $ne: "stopped" } }, { $set: { status: "stopped" } });
  if (!watch) throw new ApiError(404, "That watch has already stopped.");
  return { stopped: true };
};

/* ---------- Checking ---------- */

const checkResalePrice = async (watch, now) => {
  const listings = await EventTicket.find({
    eventId: watch.eventId,
    resaleStatus: "listed",
    status: "paid",
    buyerUserId: { $ne: watch.userId },
  })
    .select("resalePriceNaira resaleQuantity quantity")
    .lean();

  const priced = listings.map((ticket) => ({ ticket, price: holds.perTicketResalePrice(ticket) })).sort((a, b) => a.price - b.price);
  const cheapest = priced[0];
  const update = { lastCheckedAt: now, listingsSeen: Math.max(watch.listingsSeen || 0, listings.length) };
  const lastPrice = watch.prices?.[watch.prices.length - 1]?.priceNaira;
  const push = cheapest && cheapest.price !== lastPrice ? { $push: { prices: { $each: [{ at: now, priceNaira: cheapest.price }], $slice: -PRICE_HISTORY } } } : {};

  if (!cheapest || cheapest.price > watch.maxPriceNaira) {
    await VeraWatch.updateOne({ _id: watch._id }, { $set: update, ...push });
    return;
  }

  /* Claim the trigger first, so two ticks can't both alert. */
  const claimed = await VeraWatch.findOneAndUpdate(
    { _id: watch._id, status: "watching" },
    { $set: { ...update, status: "triggered", triggeredAt: now, triggerEventId: watch.eventId, triggerPriceNaira: cheapest.price }, ...push },
    { new: true },
  );
  if (!claimed) return;

  const event = await Event.findById(watch.eventId).select("name");
  let held = null;
  if (watch.action === "hold") {
    held = await holds.createResaleHold({ userId: watch.userId, resaleTicketId: cheapest.ticket._id, source: "watch", now }).catch(() => null);
    if (held) await VeraWatch.updateOne({ _id: watch._id }, { $set: { holdId: held._id } });
  }

  await notify({
    userId: watch.userId,
    type: "vera.watch.resale",
    title: held ? "Vera is holding a ticket for you" : "A resale dropped under your line",
    message: `${event?.name || "Your event"}: ${naira(cheapest.price)} a ticket, under your ${naira(watch.maxPriceNaira)}.${held ? " Held for 10 minutes." : ""}`,
    data: { target: "event-details", eventId: toIdString(watch.eventId) },
  });
};

const checkHostDrop = async (watch, now) => {
  const announced = await Event.findOne({
    organizerUserId: watch.organizerUserId,
    status: "published",
    createdAt: { $gt: watch.createdAt },
    endsAt: { $gt: now },
    ...(watch.eventId ? { _id: { $ne: watch.eventId } } : {}),
  })
    .sort({ createdAt: -1 })
    .select("name");

  if (!announced) {
    await VeraWatch.updateOne({ _id: watch._id }, { $set: { lastCheckedAt: now } });
    return;
  }

  const claimed = await VeraWatch.findOneAndUpdate(
    { _id: watch._id, status: "watching" },
    { $set: { lastCheckedAt: now, status: "triggered", triggeredAt: now, triggerEventId: announced._id } },
    { new: true },
  );
  if (!claimed) return;

  let held = null;
  if (watch.action === "hold") {
    held = await holds.createPrimaryHold({ userId: watch.userId, eventId: announced._id, quantity: 1, source: "watch", now }).catch(() => null);
    if (held) await VeraWatch.updateOne({ _id: watch._id }, { $set: { holdId: held._id } });
  }

  const host = await User.findById(watch.organizerUserId).select("fullName");
  await notify({
    userId: watch.userId,
    type: "vera.watch.host",
    title: `${hostName(host)} just announced something`,
    message: `${announced.name} is out.${held ? " Vera is holding a ticket for you for 10 minutes." : ""}`,
    data: { target: "event-details", eventId: toIdString(announced._id) },
  });
};

const checkWatch = async (watch, now = new Date()) => {
  if (watch.status !== "watching") return;
  if (watch.kind === "resale_price") await checkResalePrice(watch, now);
  else await checkHostDrop(watch, now);
};

/** One pass over every live watch, oldest-checked first. Safe to run on a timer. */
const runWatches = async ({ now = new Date(), limit = 200 } = {}) => {
  const due = await VeraWatch.find({ status: "watching" }).sort({ lastCheckedAt: 1 }).limit(limit).lean();
  for (const watch of due) {
    try {
      await checkWatch(watch, now);
    } catch (error) {
      console.error("[VeraWatch] check failed", toIdString(watch._id), error?.message);
    }
  }
};

/* ---------- Listing ---------- */

const presentWatch = (watch, eventById = new Map()) => {
  const event = eventById.get(toIdString(watch.triggerEventId || watch.eventId));
  const prices = (watch.prices || []).map((point) => point.priceNaira);
  return {
    _id: toIdString(watch._id),
    kind: watch.kind,
    label: watch.label,
    action: watch.action,
    status: watch.status,
    eventId: watch.triggerEventId ? toIdString(watch.triggerEventId) : watch.eventId ? toIdString(watch.eventId) : null,
    eventName: event?.name || "",
    maxPriceNaira: watch.maxPriceNaira ?? null,
    prices,
    lowestPriceNaira: prices.length ? Math.min(...prices) : null,
    listingsSeen: watch.listingsSeen || 0,
    triggeredAt: watch.triggeredAt,
    triggerPriceNaira: watch.triggerPriceNaira ?? null,
    holdId: watch.holdId ? toIdString(watch.holdId) : null,
    createdAt: watch.createdAt,
  };
};

/** Live watches, plus waitlists they're on, which are watches of a kind. */
const listMyWatches = async ({ userId }) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [watches, entries] = await Promise.all([
    VeraWatch.find({ userId: id, status: { $in: ["watching", "triggered"] } }).sort({ createdAt: -1 }).lean(),
    EventWaitlistEntry.find({ userId: id, status: { $in: ["waiting", "notified"] } }).lean(),
  ]);

  const eventIds = [...watches.map((watch) => watch.triggerEventId || watch.eventId), ...entries.map((entry) => entry.eventId)].filter(Boolean);
  const eventRows = await Event.find({ _id: { $in: eventIds } }).select("name").lean();
  const eventById = new Map(eventRows.map((event) => [toIdString(event._id), event]));

  const waitlists = await Promise.all(
    entries.map(async (entry) => ({
      _id: toIdString(entry._id),
      eventId: toIdString(entry.eventId),
      eventName: eventById.get(toIdString(entry.eventId))?.name || "",
      status: entry.status,
      position:
        entry.status === "waiting"
          ? (await EventWaitlistEntry.countDocuments({ eventId: entry.eventId, status: "waiting", createdAt: { $lt: entry.createdAt } })) + 1
          : null,
    })),
  );

  return { items: watches.map((watch) => presentWatch(watch, eventById)), waitlists };
};

module.exports = {
  MAX_ACTIVE_WATCHES,
  createWatch,
  updateWatch,
  stopWatch,
  runWatches,
  listMyWatches,
};
