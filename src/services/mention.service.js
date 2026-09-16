const EventTicket = require("../models/event-ticket.model");
const User = require("../models/user.model");

const toIdString = (value) => String(value?._id || value || "").trim();

/**
 * Who a message is trying to get the attention of.
 *
 * "@chat" is parsed from the text because it is one unambiguous token, and a
 * client that forgot to declare it would otherwise ping nobody. Individual
 * mentions arrive as ids from the composer's picker instead: a display name
 * can contain spaces, so "@Adaeze Okonkwo" cannot be recovered from the text
 * without guessing where the name stops.
 */

/* Word-boundary on both sides, so "hello@chatroom" is not a broadcast. */
const EVERYONE_PATTERN = /(^|\s)@chat\b/i;

const mentionsEveryone = (message) =>
  EVERYONE_PATTERN.test(String(message || ""));

/**
 * Everyone holding a live ticket to this event, plus its organizer.
 *
 * Bounded: a sold-out arena is not a reason to build an unbounded array, and
 * a broadcast past this many people needs a fan-out worker rather than a
 * request handler.
 */
const BROADCAST_LIMIT = 2000;

const listEventAudience = async ({ event, excludeUserId }) => {
  const rows = await EventTicket.find({
    eventId: event._id,
    status: { $in: ["paid", "used"] },
  })
    .select("buyerUserId")
    .limit(BROADCAST_LIMIT)
    .lean();

  const ids = new Set(rows.map((row) => toIdString(row.buyerUserId)));
  const organizerUserId = toIdString(event.organizerUserId);

  if (organizerUserId) {
    ids.add(organizerUserId);
  }

  ids.delete(toIdString(excludeUserId));
  ids.delete("");

  return [...ids];
};

/**
 * Narrows the ids a composer sent to people who can actually see this event's
 * chat. Without it, a crafted request could use a mention as a way to push a
 * notification to any user id at all.
 */
const resolveDirectMentions = async ({ event, candidateUserIds, actorUserId }) => {
  const wanted = [...new Set((candidateUserIds || []).map(toIdString))].filter(
    (id) => id && id !== toIdString(actorUserId),
  );

  if (!wanted.length) {
    return [];
  }

  const audience = new Set(
    await listEventAudience({ event, excludeUserId: actorUserId }),
  );
  const allowed = wanted.filter((id) => audience.has(id));

  if (!allowed.length) {
    return [];
  }

  /* Names come from the database, never from the sender: the stored name is
     what a client will highlight, and trusting theirs would let a message
     paint any run of its own text as a mention. */
  const users = await User.find({ _id: { $in: allowed } })
    .select("fullName")
    .lean();

  return users.map((user) => ({
    userId: toIdString(user._id),
    name: String(user.fullName || "").trim(),
  }));
};

/** Display names for the composer's "@" picker. */
const listMentionableUsers = async ({ event, actorUserId, search, limit = 20 }) => {
  const audience = await listEventAudience({ event, excludeUserId: actorUserId });

  if (!audience.length) {
    return [];
  }

  const term = String(search || "").trim();
  const query = { _id: { $in: audience } };

  if (term) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ fullName: pattern }, { title: pattern }];
  }

  return User.find(query)
    .select("fullName avatarUrl title verificationBadge")
    .limit(Math.min(50, Math.max(1, Number(limit) || 20)))
    .lean();
};

module.exports = {
  BROADCAST_LIMIT,
  mentionsEveryone,
  listEventAudience,
  resolveDirectMentions,
  listMentionableUsers,
};
