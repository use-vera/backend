const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventWaitlistEntry = require("../models/event-waitlist-entry.model");
const { countReservedTickets, resolveTicketSalesAccess } = require("./event.service");
const { createNotification } = require("./notification.service");

const HOUR_MS = 60 * 60 * 1000;
/* How long someone who was told about a spot has it to themselves before the
   next person in line is told too. */
const NOTIFIED_HOLD_MS = 2 * HOUR_MS;

const notify = (payload) => void createNotification({ push: true, ...payload }).catch(() => null);

const openSpotsFor = async (event, now = new Date()) => {
  if (event.status !== "published" || !resolveTicketSalesAccess(event, now).canPurchase) {
    return 0;
  }
  const reserved = await countReservedTickets(event._id);
  return Math.max(0, Number(event.expectedTickets || 0) - reserved);
};

const holdsTicket = (eventId, userId) =>
  EventTicket.exists({ eventId, buyerUserId: userId, status: { $in: ["paid", "used"] } });

/** This user's place on an event's waitlist, if they're on it. */
const getMyWaitlistStatus = async ({ eventId, actorUserId }) => {
  const entry = await EventWaitlistEntry.findOne({ eventId, userId: actorUserId });
  const waitingCount = await EventWaitlistEntry.countDocuments({ eventId, status: "waiting" });

  if (!entry || entry.status === "left") {
    return { joined: false, status: null, position: null, waitingCount };
  }

  const position =
    entry.status === "waiting"
      ? (await EventWaitlistEntry.countDocuments({
          eventId,
          status: "waiting",
          createdAt: { $lt: entry.createdAt },
        })) + 1
      : null;

  return { joined: true, status: entry.status, position, waitingCount, notifiedAt: entry.notifiedAt };
};

/** Joins the line for a sold-out event. Joining again keeps your place. */
const joinWaitlist = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId);

  if (!event || event.status !== "published") {
    throw new ApiError(404, "Event not found");
  }
  if (event.endsAt && new Date(event.endsAt).getTime() <= Date.now()) {
    throw new ApiError(409, "This event has ended");
  }
  if (await holdsTicket(event._id, actorUserId)) {
    throw new ApiError(409, "You already have a ticket for this event", null, "ALREADY_HAS_TICKET");
  }
  if ((await openSpotsFor(event)) > 0) {
    throw new ApiError(409, "Tickets are available now, so there's no need to wait", null, "NOT_SOLD_OUT");
  }

  const existing = await EventWaitlistEntry.findOne({ eventId, userId: actorUserId });

  if (!existing) {
    await EventWaitlistEntry.create({ eventId, userId: actorUserId });
  } else if (existing.status !== "waiting" && existing.status !== "notified") {
    /* Coming back after leaving or missing a turn goes to the back. */
    await EventWaitlistEntry.deleteOne({ _id: existing._id });
    await EventWaitlistEntry.create({ eventId, userId: actorUserId });
  }

  return getMyWaitlistStatus({ eventId, actorUserId });
};

const leaveWaitlist = async ({ eventId, actorUserId }) => {
  await EventWaitlistEntry.updateOne(
    { eventId, userId: actorUserId, status: { $in: ["waiting", "notified"] } },
    { $set: { status: "left" } },
  );
  return getMyWaitlistStatus({ eventId, actorUserId });
};

/**
 * Tells people in line when spots open: as many as there are free tickets,
 * minus those already told and still inside their hold. People who were told
 * and bought are marked done; people whose hold ran out make room for the
 * next ones. Safe to run on a timer.
 */
const processWaitlists = async ({ now = new Date() } = {}) => {
  const eventIds = await EventWaitlistEntry.distinct("eventId", { status: { $in: ["waiting", "notified"] } });

  for (const eventId of eventIds) {
    const event = await Event.findById(eventId);
    if (!event) continue;

    const notified = await EventWaitlistEntry.find({ eventId, status: "notified" });
    let stillHolding = 0;

    for (const entry of notified) {
      if (await holdsTicket(eventId, entry.userId)) {
        await EventWaitlistEntry.updateOne({ _id: entry._id }, { $set: { status: "purchased" } });
      } else if (new Date(entry.notifiedAt).getTime() + NOTIFIED_HOLD_MS <= now.getTime()) {
        await EventWaitlistEntry.updateOne({ _id: entry._id, status: "notified" }, { $set: { status: "expired" } });
      } else {
        stillHolding += 1;
      }
    }

    const ended = event.endsAt && new Date(event.endsAt).getTime() <= now.getTime();
    if (ended || event.status === "cancelled") {
      await EventWaitlistEntry.updateMany(
        { eventId, status: { $in: ["waiting", "notified"] } },
        { $set: { status: "expired" } },
      );
      continue;
    }

    const toNotify = (await openSpotsFor(event, now)) - stillHolding;
    if (toNotify <= 0) continue;

    const next = await EventWaitlistEntry.find({ eventId, status: "waiting" }).sort({ createdAt: 1 }).limit(toNotify);

    for (const entry of next) {
      const claimed = await EventWaitlistEntry.findOneAndUpdate(
        { _id: entry._id, status: "waiting" },
        { $set: { status: "notified", notifiedAt: now } },
        { new: true },
      );
      if (!claimed) continue;

      notify({
        userId: claimed.userId,
        type: "event.waitlist.spot_open",
        title: "A ticket just opened up",
        message: `A spot opened for ${event.name}. Grab it before someone else does.`,
        data: { target: "event-details", eventId: String(event._id) },
      });
    }
  }
};

module.exports = {
  NOTIFIED_HOLD_MS,
  getMyWaitlistStatus,
  joinWaitlist,
  leaveWaitlist,
  processWaitlists,
};
