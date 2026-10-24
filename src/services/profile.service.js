const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Category = require("../models/category.model");
const UserBlock = require("../models/user-block.model");

/* Lazy, because event.service is large and requires much of the app. */
const eventCards = () => require("./event.service");

const toIdString = (value) => String(value?._id || value || "");

const normalizeHandle = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

const PUBLIC_USER_FIELDS = "fullName handle avatarUrl bio state title verificationBadge preferences.shareActivityWithFollowers preferences.preferredCategoryIds";
const BEEN_TO_LIMIT = 12;
const HOSTING_LIMIT = 20;

/* Lagos has no daylight saving, so a fixed offset puts a night out in the
   month it happened there, not the month it was in UTC. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const lagosMonthOf = (date) => new Date(date.getTime() + LAGOS_OFFSET_MS).getUTCMonth();
const lagosYearOf = (date) => new Date(date.getTime() + LAGOS_OFFSET_MS).getUTCFullYear();

/* What someone is going to: paid tickets for published events that haven't ended. */
const listGoing = async (userId, viewerId, now) => {
  const eventIds = await EventTicket.distinct("eventId", { buyerUserId: userId, status: "paid" });
  const events = await Event.find({ _id: { $in: eventIds }, status: "published", endsAt: { $gte: now } })
    .populate(eventCards().EVENT_CARD_POPULATE)
    .sort({ startsAt: 1 })
    .limit(20);
  return eventCards().presentEventCards({ events, actorUserId: viewerId });
};

/* Where someone has been: events they were checked in at. */
const listBeenTo = async (userId, viewerId) => {
  const eventIds = await EventTicket.distinct("eventId", { buyerUserId: userId, status: "used" });
  const filter = { _id: { $in: eventIds }, status: { $in: ["published", "cancelled"] } };
  const [events, total] = await Promise.all([
    Event.find(filter).populate(eventCards().EVENT_CARD_POPULATE).sort({ startsAt: -1 }).limit(BEEN_TO_LIMIT),
    Event.countDocuments(filter),
  ]);
  return { items: await eventCards().presentEventCards({ events, actorUserId: viewerId }), total };
};

/* What someone is hosting: their published events that haven't ended. Hosting is
   public, so unlike going and been-to it isn't gated on following. */
const listHosting = async (userId, viewerId, now) => {
  const events = await Event.find({ organizerUserId: userId, status: "published", endsAt: { $gte: now } })
    .populate(eventCards().EVENT_CARD_POPULATE)
    .sort({ startsAt: 1 })
    .limit(HOSTING_LIMIT);
  return eventCards().presentEventCards({ events, actorUserId: viewerId });
};

const notFound = (message) => new ApiError(404, message, null, "USER_NOT_FOUND");

/**
 * A profile looked up by @handle.
 *
 * What someone is going to and has been to is shown only to themselves and
 * to their followers, and to followers only while they share activity.
 * Everyone else sees who they are, not where they go.
 */
const getPublicProfileByHandle = async ({ handle, viewerUserId }) => {
  const normalized = normalizeHandle(handle);
  const user = normalized ? await User.findOne({ handle: normalized, deletedAt: null }).select(PUBLIC_USER_FIELDS).lean() : null;
  return presentPublicProfile({ user, viewerUserId, missing: "Nobody has that handle" });
};

/** The same profile, for places that only know who someone is, not their handle (avatars). */
const getPublicProfileById = async ({ userId, viewerUserId }) => {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select(PUBLIC_USER_FIELDS).lean();
  return presentPublicProfile({ user, viewerUserId, missing: "We couldn't find that person" });
};

const presentPublicProfile = async ({ user, viewerUserId, missing }) => {
  if (!user) {
    throw notFound(missing);
  }

  const targetId = user._id;
  const viewerId = toIdString(viewerUserId);
  const isMe = viewerId === toIdString(targetId);
  const sharing = user.preferences?.shareActivityWithFollowers !== false;

  /* Blocked by them: the profile doesn't exist for you. Blocked by you: you
     see enough to unblock, and nothing they do. */
  const [theyBlockedYou, youBlockedThem] = isMe
    ? [false, false]
    : await Promise.all([
        UserBlock.exists({ blockerUserId: targetId, blockedUserId: viewerId }),
        UserBlock.exists({ blockerUserId: viewerId, blockedUserId: targetId }),
      ]);

  if (theyBlockedYou) {
    throw notFound(missing);
  }

  const [isFollowing, followsYou, followersCount, followingCount, viewerFollowingIds] = await Promise.all([
    isMe ? false : Follow.exists({ followerUserId: viewerId, followingUserId: targetId }),
    isMe ? false : Follow.exists({ followerUserId: targetId, followingUserId: viewerId }),
    Follow.countDocuments({ followingUserId: targetId }),
    Follow.countDocuments({ followerUserId: targetId }),
    isMe ? [] : Follow.distinct("followingUserId", { followerUserId: viewerId }),
  ]);

  /* People the viewer follows who also follow this person. */
  const mutualFilter = { followerUserId: { $in: viewerFollowingIds }, followingUserId: targetId };
  const [mutualCount, mutualRows] = await Promise.all([
    viewerFollowingIds.length ? Follow.countDocuments(mutualFilter) : 0,
    viewerFollowingIds.length
      ? Follow.find(mutualFilter).sort({ createdAt: -1 }).limit(3).populate("followerUserId", "fullName").lean()
      : [],
  ]);

  const categoryIds = user.preferences?.preferredCategoryIds || [];
  const categories = categoryIds.length
    ? await Category.find({ _id: { $in: categoryIds }, isActive: true }).select("name").sort({ sortOrder: 1 }).lean()
    : [];

  const activityVisible = !youBlockedThem && (isMe || (sharing && Boolean(isFollowing)));
  const now = new Date();
  const [going, beenTo] = activityVisible
    ? await Promise.all([listGoing(targetId, viewerId, now), listBeenTo(targetId, viewerId)])
    : [[], { items: [], total: 0 }];
  const hosting = youBlockedThem ? [] : await listHosting(targetId, viewerId, now);

  return {
    user: {
      _id: toIdString(targetId),
      fullName: user.fullName,
      handle: user.handle,
      avatarUrl: user.avatarUrl || "",
      bio: user.bio || "",
      state: user.state || "",
      title: user.title || "",
      verificationBadge: user.verificationBadge,
    },
    isMe,
    blockedByYou: Boolean(youBlockedThem),
    isFollowing: Boolean(isFollowing),
    followsYou: Boolean(followsYou),
    followersCount,
    followingCount,
    mutuals: {
      count: mutualCount,
      names: mutualRows.map((row) => row.followerUserId?.fullName).filter(Boolean),
    },
    scenes: categories.map((category) => category.name),
    hosting,
    activity: {
      /* Whether this viewer can see it, and whether followers can at all. */
      visible: activityVisible,
      sharing,
      going,
      beenTo: beenTo.items,
      beenToCount: activityVisible ? beenTo.total : null,
    },
  };
};

/**
 * "Your year so far": nights out, hosts, places and the shape of the year,
 * counted from the events you were checked in at.
 */
const getMyRecap = async ({ userId, year }) => {
  const now = new Date();
  const targetYear = Number(year) || lagosYearOf(now);
  const start = new Date(Date.UTC(targetYear, 0, 1) - LAGOS_OFFSET_MS);
  const end = new Date(Date.UTC(targetYear + 1, 0, 1) - LAGOS_OFFSET_MS);

  const tickets = await EventTicket.find({
    buyerUserId: userId,
    status: "used",
    usedAt: { $gte: start, $lt: end },
  })
    .select("eventId usedAt")
    .lean();

  /* One night per event, dated by the first check-in. */
  const firstCheckIn = new Map();
  for (const ticket of tickets) {
    const key = toIdString(ticket.eventId);
    const at = new Date(ticket.usedAt);
    if (!firstCheckIn.has(key) || at < firstCheckIn.get(key)) firstCheckIn.set(key, at);
  }

  const events = await Event.find({ _id: { $in: [...firstCheckIn.keys()] } })
    .select("organizerUserId eventCenterId address state categoryIds")
    .lean();

  const months = Array.from({ length: 12 }, () => 0);
  for (const at of firstCheckIn.values()) months[lagosMonthOf(at)] += 1;

  const hosts = new Set(events.map((event) => toIdString(event.organizerUserId)).filter(Boolean));
  const places = new Set(
    events
      .map((event) => toIdString(event.eventCenterId) || String(event.address || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const categoryCounts = new Map();
  for (const event of events) {
    for (const id of event.categoryIds || []) {
      const key = toIdString(id);
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }
  }
  const [topCategoryId] = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const topCategory = topCategoryId ? await Category.findById(topCategoryId).select("name").lean() : null;

  const busiest = Math.max(...months);
  const isCurrentYear = targetYear === lagosYearOf(now);

  return {
    year: targetYear,
    nights: firstCheckIn.size,
    hosts: hosts.size,
    places: places.size,
    months,
    /* How many months to draw: the whole year once it's over. */
    monthsSoFar: isCurrentYear ? lagosMonthOf(now) + 1 : 12,
    busiestMonth: busiest > 0 ? months.indexOf(busiest) : null,
    topScene: topCategory?.name || null,
  };
};

/**
 * People search for Search: by name or handle only, never email. Deleted
 * accounts and anyone blocked either way are left out.
 */
const searchPeople = async ({ viewerUserId, q, limit = 10 }) => {
  const term = String(q || "").trim().replace(/^@+/, "");

  if (term.length < 2) {
    return { items: [] };
  }

  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const blocks = await UserBlock.find({ $or: [{ blockerUserId: viewerUserId }, { blockedUserId: viewerUserId }] })
    .select("blockerUserId blockedUserId")
    .lean();
  const hidden = new Set(blocks.flatMap((row) => [toIdString(row.blockerUserId), toIdString(row.blockedUserId)]));
  hidden.add(toIdString(viewerUserId));

  const users = await User.find({
    _id: { $nin: [...hidden] },
    deletedAt: null,
    $or: [{ fullName: pattern }, { handle: pattern }],
  })
    .select("fullName handle avatarUrl title")
    .limit(Math.min(20, Number(limit) || 10))
    .lean();

  return {
    items: users.map((user) => ({
      _id: toIdString(user._id),
      fullName: user.fullName,
      handle: user.handle || "",
      avatarUrl: user.avatarUrl || "",
      title: user.title || "",
    })),
  };
};

module.exports = { getPublicProfileByHandle, getPublicProfileById, getMyRecap, searchPeople };
