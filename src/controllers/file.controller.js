const asyncHandler = require("../utils/async-handler");
const { uploadAsset } = require("../services/file.service");

const resolveRequestOrigin = (req) => {
  const protoHeader = String(req.headers["x-forwarded-proto"] || "").trim();
  const protocol = protoHeader || req.protocol || "http";
  const host = String(req.headers.host || "").trim();

  if (!host) {
    return "";
  }

  return `${protocol}://${host}`;
};

const uploadAssetController = asyncHandler(async (req, res) => {
  const result = await uploadAsset({
    actorUserId: req.auth.userId,
    payload: req.body,
    requestOrigin: resolveRequestOrigin(req),
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
