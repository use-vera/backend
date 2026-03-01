const ApiError = require("../utils/api-error");
const cloudinary = require("../config/cloudinary");

const uploadAsset = async ({ actorUserId, payload }) => {
  if (!actorUserId) {
    throw new ApiError(401, "Authentication is required");
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new ApiError(503, "File uploads are not configured");
  }

  const folder = String(payload.folder || "vera").trim();

  let result;

  try {
    result = await cloudinary.uploader.upload(payload.dataUri, {
      folder,
      resource_type: payload.resourceType || "auto",
      overwrite: false,
      use_filename: false,
      unique_filename: true,
    });
  } catch (error) {
    throw new ApiError(502, "Cloud upload failed", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const secureUrl = String(result?.secure_url || "").trim();

  if (!secureUrl) {
    throw new ApiError(502, "Upload completed without a file URL");
  }

  return {
    url: secureUrl,
    publicId: String(result.public_id || "").trim(),
    resourceType: String(result.resource_type || payload.resourceType || "auto"),
    width:
      typeof result.width === "number" && Number.isFinite(result.width)
        ? result.width
        : null,
    height:
      typeof result.height === "number" && Number.isFinite(result.height)
        ? result.height
        : null,
    duration:
      typeof result.duration === "number" && Number.isFinite(result.duration)
        ? result.duration
        : null,
    bytes:
      typeof result.bytes === "number" && Number.isFinite(result.bytes)
        ? result.bytes
        : null,
    format: String(result.format || "").trim() || null,
  };
};

module.exports = {
  uploadAsset,
};
