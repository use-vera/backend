const Event = require("../models/event.model");

/**
 * "#Afrobeats Night Lagos" in a chat message.
 *
 * Like @mentions, these arrive as ids from the composer's picker rather than
 * being parsed from the text: event names contain spaces, so the end of a
 * name can't be found by looking. The server keeps an id only when it is a
 * published event and "#" plus its real name is still in the message, so a
 * crafted request can't turn arbitrary text into a link, or link a draft.
 */

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const MAX_MENTIONS = 5;
const SUGGESTION_LIMIT = 8;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveEventMentions = async ({ message, candidateEventIds }) => {
  const text = String(message || "").toLowerCase();
  const ids = [...new Set((Array.isArray(candidateEventIds) ? candidateEventIds : []).map(String))]
    .filter((id) => objectIdRegex.test(id))
    .slice(0, MAX_MENTIONS * 2);

  if (!ids.length || !text.includes("#")) {
    return [];
  }

  const events = await Event.find({ _id: { $in: ids }, status: { $ne: "draft" } })
    .select("_id name")
    .lean();

  return events
    .filter((event) => event.name && text.includes(`#${event.name.toLowerCase()}`))
    .slice(0, MAX_MENTIONS)
    .map((event) => ({ eventId: event._id, name: event.name }));
};

/** After an edit: keep only the mentions whose "#Name" survived it. */
const keepMentionsStillInText = (mentions, message) => {
  const text = String(message || "").toLowerCase();
  return (Array.isArray(mentions) ? mentions : []).filter(
    (mention) => mention?.name && text.includes(`#${String(mention.name).toLowerCase()}`),
  );
};

/** What the composer offers after "#": upcoming published events, soonest first. */
const searchMentionableEvents = async ({ search = "", limit = SUGGESTION_LIMIT, now = new Date() }) => {
  const query = { status: "published", endsAt: { $gt: now } };
  const term = String(search || "").trim().slice(0, 60);
  if (term) {
    query.name = { $regex: escapeRegex(term), $options: "i" };
  }

  const events = await Event.find(query)
    .select("_id name startsAt endsAt imageUrl")
    .sort({ startsAt: 1 })
    .limit(Math.min(SUGGESTION_LIMIT, Math.max(1, Number(limit) || SUGGESTION_LIMIT)))
    .lean();

  return events.map((event) => ({
    eventId: String(event._id),
    name: event.name,
    startsAt: event.startsAt,
    imageUrl: event.imageUrl || "",
  }));
};

module.exports = {
  MAX_MENTIONS,
  resolveEventMentions,
  keepMentionsStillInText,
  searchMentionableEvents,
};
