const asyncHandler = require("../utils/async-handler");
const { uploadAsset } = require("../services/file.service");

const uploadAssetController = asyncHandler(async (req, res) => {
  const result = await uploadAsset({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "File uploaded",
    data: result,
  });
});

module.exports = {
  uploadAssetController,
};
