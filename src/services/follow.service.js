const ApiError = require("../utils/api-error");
const Follow = require("../models/follow.model");
const User = require("../models/user.model");
const { createNotification } = require("./notification.service");

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

  if (!targetUser) {
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

const listFollowers = async ({ userId, page, limit }) => {
  const { pageNumber, limitNumber, skip } = normalizePagination({
    page,
    limit,
  });

  const [rows, totalItems] = await Promise.all([
    Follow.find({ followingUserId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate(
        "followerUserId",
        "fullName avatarUrl title verificationBadge",
      ),
    Follow.countDocuments({ followingUserId: userId }),
  ]);

  return {
    items: rows.map((row) => row.followerUserId).filter(Boolean),
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const listFollowing = async ({ userId, page, limit, search }) => {
  const { pageNumber, limitNumber, skip } = normalizePagination({
    page,
    limit,
  });

  /* Searching has to happen here rather than on the loaded page: the names
     being searched belong to the followed user, not to the follow edge, and
     a client filtering one page can only ever find what that page holds. */
  const term = String(search || "").trim();
  const filter = { followerUserId: userId };

  if (term) {
    const pattern = new RegExp(
      term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const matches = await User.find({
      $or: [{ fullName: pattern }, { title: pattern }, { email: pattern }],
    }).select("_id");

    filter.followingUserId = { $in: matches.map((match) => match._id) };
  }

  const [rows, totalItems] = await Promise.all([
    Follow.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate(
        "followingUserId",
        "fullName avatarUrl title verificationBadge",
      ),
    Follow.countDocuments(filter),
  ]);

  return {
    items: rows.map((row) => row.followingUserId).filter(Boolean),
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowStatus,
  listFollowers,
  listFollowing,
};
