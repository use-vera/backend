const asyncHandler = require("../utils/async-handler");
const {
  followUser,
  unfollowUser,
  getFollowStatus,
  listFollowers,
  listFollowing,
} = require("../services/follow.service");

const followUserController = asyncHandler(async (req, res) => {
  const result = await followUser({
    actorUserId: req.auth.userId,
    targetUserId: req.params.userId,
  });

  res.status(200).json({
    success: true,
    message: "Now following user",
    data: result,
  });
});

const unfollowUserController = asyncHandler(async (req, res) => {
  const result = await unfollowUser({
    actorUserId: req.auth.userId,
    targetUserId: req.params.userId,
  });

  res.status(200).json({
    success: true,
    message: "Unfollowed user",
    data: result,
  });
});

const getFollowStatusController = asyncHandler(async (req, res) => {
  const result = await getFollowStatus({
    actorUserId: req.auth.userId,
    targetUserId: req.params.userId,
  });

  res.status(200).json({
    success: true,
    message: "Follow status fetched",
    data: result,
  });
});

const listFollowersController = asyncHandler(async (req, res) => {
  const result = await listFollowers({
    userId: req.params.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Followers fetched",
    data: result,
  });
});

const listFollowingController = asyncHandler(async (req, res) => {
  const result = await listFollowing({
    userId: req.params.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Following fetched",
    data: result,
  });
});

module.exports = {
  followUserController,
  unfollowUserController,
  getFollowStatusController,
  listFollowersController,
  listFollowingController,
};
