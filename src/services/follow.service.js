const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const Follow = require("../models/follow.model");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Category = require("../models/category.model");
const { createNotification } = require("./notification.service");
const { isBlockedEitherWay } = require("./account-security.service");

const normalizePagination = ({ page = 1, limit = 20, maxLimit = 50 }) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(maxLimit, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;

  return { pageNumber, limitNumber, skip };
};

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
  };
};

const toIdString = (value) => String(value?._id || value || "");

const followUser = async ({ actorUserId, targetUserId }) => {
  const actorId = toIdString(actorUserId);
  const targetId = toIdString(targetUserId);

  if (!targetId) {
    throw new ApiError(400, "A user to follow is required");
  }

  if (actorId === targetId) {
    throw new ApiError(400, "You cannot follow yourself");
  }

  const targetUser = await User.findById(targetId).select("fullName");

  /* Blocked either way looks the same as not existing. */
  if (!targetUser || (await isBlockedEitherWay(actorId, targetId))) {
    throw new ApiError(404, "User not found");
  }

  const existing = await Follow.findOne({
    followerUserId: actorId,
    followingUserId: targetId,
  });

  if (!existing) {
    await Follow.create({
      followerUserId: actorId,
      followingUserId: targetId,
    });

    const actorUser = await User.findById(actorId).select("fullName");

    void createNotification({
      userId: targetId,
      type: "user.followed",
      title: actorUser?.fullName || "Someone",
      message: "started following you",
      data: { target: "user-profile", followerUserId: actorId },
      push: true,
    }).catch(() => null);
  }

  return getFollowStatus({ actorUserId: actorId, targetUserId: targetId });
};

const unfollowUser = async ({ actorUserId, targetUserId }) => {
  const actorId = toIdString(actorUserId);
  const targetId = toIdString(targetUserId);

  await Follow.deleteOne({
    followerUserId: actorId,
    followingUserId: targetId,
  });

  return getFollowStatus({ actorUserId: actorId, targetUserId: targetId });
};

const getFollowStatus = async ({ actorUserId, targetUserId }) => {
  const actorId = toIdString(actorUserId);
  const targetId = toIdString(targetUserId);

  const [isFollowing, followersCount, followingCount] = await Promise.all([
    actorId
      ? Follow.exists({ followerUserId: actorId, followingUserId: targetId })
      : Promise.resolve(false),
    Follow.countDocuments({ followingUserId: targetId }),
    Follow.countDocuments({ followerUserId: targetId }),
  ]);

  return {
    isFollowing: Boolean(isFollowing),
    followersCount,
    followingCount,
  };
};

/* Narrows a connections list to people whose name or handle matches. It has
   to happen here rather than on the loaded page: the names belong to the
   other user, not to the follow edge, and a client filtering one page can
   only ever find what that page holds. */
const matchingUserIds = async (search) => {
  const term = String(search || "").trim();

  if (!term) {
    return null;
  }

  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matches = await User.find({
    $or: [{ fullName: pattern }, { handle: pattern }, { title: pattern }, { email: pattern }],
  }).select("_id");

  return matches.map((match) => match._id);
};

const CONNECTION_FIELDS = "fullName avatarUrl handle title verificationBadge";

/* Marks each person with whether the viewer follows them, so a list can show
   "Following" or "Follow back" without a status call per row. */
const withViewerFollows = async (users, viewerUserId) => {
  const viewerId = toIdString(viewerUserId);
  const ids = users.map((user) => user._id);
  const followed = viewerId
    ? await Follow.find({ followerUserId: viewerId, followingUserId: { $in: ids } }).distinct(
        "followingUserId",
      )
    : [];
  const followedSet = new Set(followed.map(String));

  return users.map((user) => ({
    ...user.toObject(),
    viewerFollows: followedSet.has(String(user._id)),
  }));
};

const listConnections = async ({ userId, viewerUserId, page, limit, search, direction }) => {
  const { pageNumber, limitNumber, skip } = normalizePagination({
    page,
    limit,
  });
  const ownField = direction === "followers" ? "followingUserId" : "followerUserId";
  const otherField = direction === "followers" ? "followerUserId" : "followingUserId";
  const filter = { [ownField]: userId };
  const matches = await matchingUserIds(search);

  if (matches) {
    filter[otherField] = { $in: matches };
  }

  const [rows, totalItems] = await Promise.all([
    Follow.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate(otherField, CONNECTION_FIELDS),
    Follow.countDocuments(filter),
  ]);

  const users = rows.map((row) => row[otherField]).filter(Boolean);

  return {
    items: await withViewerFollows(users, viewerUserId),
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const listFollowers = (options) => listConnections({ ...options, direction: "followers" });

const listFollowing = (options) => listConnections({ ...options, direction: "following" });

/**
 * Hosts worth following for someone new: people with published, not-yet-
 * finished events, ranked by how well those events match the viewer's
 * picked categories and state. Nobody already followed, and never the
 * viewer themself.
 */
const listSuggestedHosts = async ({ userId, limit = 12 }) => {
  const limitNumber = Math.min(30, Math.max(1, Number(limit) || 12));
  const me = await User.findById(userId).select(
    "state preferences.preferredCategoryIds",
  );

  if (!me) {
    throw new ApiError(404, "User profile not found");
  }

  const preferredCategoryIds = (me.preferences?.preferredCategoryIds || []).map(
    (id) => new mongoose.Types.ObjectId(String(id)),
  );
  const myState = String(me.state || "").trim().toLowerCase();
  const alreadyFollowing = await Follow.find({
    followerUserId: me._id,
  }).distinct("followingUserId");

  const rows = await Event.aggregate([
    {
      $match: {
        status: "published",
        endsAt: { $gte: new Date() },
        organizerUserId: { $nin: [me._id, ...alreadyFollowing] },
      },
    },
    {
      $addFields: {
        matchedCategoryIds: {
          $setIntersection: [
            { $ifNull: ["$categoryIds", []] },
            preferredCategoryIds,
          ],
        },
        inMyState: {
          $and: [
            { $ne: [myState, ""] },
            { $eq: [{ $toLower: { $ifNull: ["$state", ""] } }, myState] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$organizerUserId",
        upcomingEventsCount: { $sum: 1 },
        categoryMatches: {
          $sum: { $cond: [{ $gt: [{ $size: "$matchedCategoryIds" }, 0] }, 1, 0] },
        },
        stateMatches: { $sum: { $cond: ["$inMyState", 1, 0] } },
        matchedCategoryIds: { $push: "$matchedCategoryIds" },
      },
    },
    {
      /* A category match is worth more than being nearby: someone in Abuja
         who hosts exactly your scene beats a Lagos host of something else. */
      $addFields: {
        score: {
          $add: [
            { $multiply: [{ $min: ["$categoryMatches", 3] }, 2] },
            { $min: ["$stateMatches", 3] },
          ],
        },
      },
    },
    { $sort: { score: -1, upcomingEventsCount: -1, _id: 1 } },
    { $limit: limitNumber },
  ]);

  if (rows.length === 0) {
    return { items: [] };
  }

  const firstMatchedCategoryId = (row) =>
    row.matchedCategoryIds.flat().map(String)[0] || "";

  const [hosts, categories] = await Promise.all([
    User.find({ _id: { $in: rows.map((row) => row._id) } }).select(
      "fullName avatarUrl handle title verificationBadge",
    ),
    Category.find({
      _id: { $in: rows.map(firstMatchedCategoryId).filter(Boolean) },
    }).select("name"),
  ]);

  const hostById = new Map(hosts.map((host) => [String(host._id), host]));
  const categoryNameById = new Map(
    categories.map((category) => [String(category._id), category.name]),
  );
  const displayState = String(me.state || "").trim();

  const describe = (row) => {
    const categoryName = categoryNameById.get(firstMatchedCategoryId(row));

    if (categoryName && row.stateMatches > 0) {
      return `Hosts ${categoryName.toLowerCase()} in ${displayState}`;
    }

    if (categoryName) {
      return `Hosts ${categoryName.toLowerCase()}`;
    }

    if (row.stateMatches > 0) {
      return `Hosting in ${displayState}`;
    }

    return row.upcomingEventsCount === 1
      ? "1 upcoming event"
      : `${row.upcomingEventsCount} upcoming events`;
  };

  return {
    items: rows
      .map((row) => {
        const host = hostById.get(String(row._id));

        if (!host) {
          return null;
        }

        return {
          _id: String(host._id),
          fullName: host.fullName,
          avatarUrl: host.avatarUrl || "",
          handle: host.handle || "",
          verificationBadge: host.verificationBadge,
          upcomingEventsCount: row.upcomingEventsCount,
          reason: describe(row),
        };
      })
      .filter(Boolean),
  };
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowStatus,
  listFollowers,
  listFollowing,
  listSuggestedHosts,
};
