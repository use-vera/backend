const asyncHandler = require("../utils/async-handler");
const { getPublicProfileByHandle, getPublicProfileById, getMyRecap, searchPeople } = require("../services/profile.service");

const getPublicProfileController = asyncHandler(async (req, res) => {
  const result = await getPublicProfileByHandle({
    handle: req.params.handle,
    viewerUserId: req.auth.userId,
  });

  res.status(200).json({ success: true, message: "Profile fetched", data: result });
});

const getPublicProfileByIdController = asyncHandler(async (req, res) => {
  const result = await getPublicProfileById({
    userId: req.params.userId,
    viewerUserId: req.auth.userId,
  });

  res.status(200).json({ success: true, message: "Profile fetched", data: result });
});

const getMyRecapController = asyncHandler(async (req, res) => {
  const result = await getMyRecap({ userId: req.auth.userId, year: req.query.year });

  res.status(200).json({ success: true, message: "Recap fetched", data: result });
});

const searchPeopleController = asyncHandler(async (req, res) => {
  const result = await searchPeople({ viewerUserId: req.auth.userId, q: req.query.q, limit: req.query.limit });

  res.status(200).json({ success: true, message: "People found", data: result });
});

module.exports = { getPublicProfileController, getPublicProfileByIdController, getMyRecapController, searchPeopleController };
