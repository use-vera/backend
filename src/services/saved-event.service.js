const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const SavedEvent = require("../models/saved-event.model");

const MAX_IMPORT = 200;

/* Lazy, because event.service is large and requires much of the app. */
const eventCards = () => require("./event.service");

const toIdString = (value) => String(value?._id || value || "");

/* You can save anything you could open: published or cancelled events, and
   your own drafts. Someone else's draft stays invisible. */
const savableFilter = (userId) => ({
  $or: [{ status: { $in: ["published", "cancelled"] } }, { organizerUserId: userId }],
});

/* Still to come: hasn't ended, or a series that keeps going. */
const upcomingFilter = (now) => ({
  $or: [
    { endsAt: { $gte: now } },
    {
      "recurrence.type": { $nin: ["none", null] },
      $or: [{ "recurrence.endsOn": null }, { "recurrence.endsOn": { $gte: now } }],
    },
  ],
});

const saveEvent = async ({ userId, eventId }) => {
  const event = await Event.findOne({ _id: eventId, ...savableFilter(userId) }).select("_id");

  if (!event) {
    throw new ApiError(404, "Event not found", null, "EVENT_NOT_FOUND");
  }

  await SavedEvent.updateOne(
    { userId, eventId: event._id },
    { $setOnInsert: { userId, eventId: event._id } },
    { upsert: true },
  );

  return { eventId: toIdString(event._id), saved: true };
};

const unsaveEvent = async ({ userId, eventId }) => {
  await SavedEvent.deleteOne({ userId, eventId });
  return { eventId: String(eventId), saved: false };
};

/** Every saved event id, so the app can show the filled bookmark anywhere. */
const listSavedEventIds = async ({ userId }) => {
  const rows = await SavedEvent.find({ userId }).select("eventId").lean();
  return { eventIds: rows.map((row) => toIdString(row.eventId)) };
};

const listSavedEvents = async ({ userId, scope = "upcoming", page = 1, limit = 20 }) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const now = new Date();

  const savedRows = await SavedEvent.find({ userId }).sort({ createdAt: -1 }).select("eventId").lean();
  const savedIds = savedRows.map((row) => row.eventId);
  const base = { _id: { $in: savedIds }, ...savableFilter(userId) };
  const upcoming = upcomingFilter(now);
  const filter = scope === "past" ? { ...base, $nor: [upcoming] } : { $and: [base, upcoming] };

  const [events, totalItems, upcomingCount, pastCount] = await Promise.all([
    Event.find(filter)
      .populate(eventCards().EVENT_CARD_POPULATE)
      .sort({ startsAt: scope === "past" ? -1 : 1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber),
    Event.countDocuments(filter),
    Event.countDocuments({ $and: [base, upcoming] }),
    Event.countDocuments({ ...base, $nor: [upcoming] }),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limitNumber);

  return {
    items: await eventCards().presentEventCards({ events, actorUserId: userId }),
    counts: { upcoming: upcomingCount, past: pastCount },
    page: pageNumber,
    limit: limitNumber,
    totalItems,
    totalPages,
    hasNextPage: pageNumber < totalPages,
    hasPrevPage: pageNumber > 1,
  };
};

/**
 * Moves saves made before they lived on the server. Ids that aren't real,
 * savable events are skipped rather than failing the lot: the phone's list
 * may hold events that have since been deleted.
 */
const importSavedEvents = async ({ userId, eventIds }) => {
  const unique = [...new Set((eventIds || []).map(String))]
    .filter((id) => mongoose.isValidObjectId(id))
    .slice(0, MAX_IMPORT);

  if (unique.length === 0) {
    return { imported: 0 };
  }

  const events = await Event.find({ _id: { $in: unique }, ...savableFilter(userId) }).select("_id").lean();

  if (events.length > 0) {
    await SavedEvent.bulkWrite(
      events.map((event) => ({
        updateOne: {
          filter: { userId, eventId: event._id },
          update: { $setOnInsert: { userId, eventId: event._id } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  return { imported: events.length };
};

module.exports = {
  MAX_IMPORT,
  saveEvent,
  unsaveEvent,
  listSavedEventIds,
  listSavedEvents,
  importSavedEvents,
};
