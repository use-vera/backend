const ApiError = require("../utils/api-error");
const cloudinary = require("../config/cloudinary");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const uploadsRootDir = path.resolve(__dirname, "..", "..", "uploads");

const mimeExtensionMap = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );

const sanitizePathSegment = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const sanitizeFolder = (value) => {
  const segments = String(value || "vera")
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean);

  return segments.length ? segments.join("/") : "vera";
};

const parseDataUri = (dataUri) => {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,([\s\S]+)$/);

  if (!match) {
    throw new ApiError(400, "Invalid file payload");
  }

  const mimeType = String(match[1] || "").trim().toLowerCase();
  const base64Data = String(match[2] || "").replace(/\s+/g, "");
  const buffer = Buffer.from(base64Data, "base64");

  if (!buffer.length) {
    throw new ApiError(400, "Uploaded file is empty");
  }

  return {
    mimeType,
    buffer,
  };
};

const inferResourceType = (mimeType, requestedType) => {
  if (requestedType && requestedType !== "auto") {
    return requestedType;
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "raw";
};

const resolveUploadOrigin = (requestOrigin) => {
  const explicitBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();

  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }

  if (requestOrigin) {
    return String(requestOrigin).replace(/\/+$/, "");
  }

  const port = Number(process.env.PORT) || 5050;
  return `http://127.0.0.1:${port}`;
};

const uploadToLocalDisk = async ({ payload, requestOrigin }) => {
  const folder = sanitizeFolder(payload.folder || "vera");
  const { mimeType, buffer } = parseDataUri(payload.dataUri);
  const extension = mimeExtensionMap[mimeType] || "bin";
  const resourceType = inferResourceType(mimeType, payload.resourceType || "auto");
  const fileId = `${Date.now()}-${crypto.randomUUID()}`;
  const fileName = `${fileId}.${extension}`;
  const fileDir = path.join(uploadsRootDir, folder);
  const filePath = path.join(fileDir, fileName);

  await fs.mkdir(fileDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  const baseUrl = resolveUploadOrigin(requestOrigin);
  const encodedSegments = folder
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${baseUrl}/uploads/${encodedSegments}/${encodeURIComponent(fileName)}`;
  const publicId = `${folder}/${fileId}`;

  return {
    url,
    publicId,
    resourceType,
    width: null,
    height: null,
    duration: null,
    bytes: buffer.length,
    format: extension,
    storage: "local",
  };
};

const uploadAsset = async ({ actorUserId, payload, requestOrigin }) => {
  if (!actorUserId) {
    throw new ApiError(401, "Authentication is required");
  }

  let result;

  if (!isCloudinaryConfigured()) {
    return uploadToLocalDisk({ payload, requestOrigin });
  }

  const folder = sanitizeFolder(payload.folder || "vera");

  try {
    result = await cloudinary.uploader.upload(payload.dataUri, {
      folder,
      resource_type: payload.resourceType || "auto",
      overwrite: false,
      use_filename: false,
      unique_filename: true,
    });
  } catch (error) {
    return uploadToLocalDisk({ payload, requestOrigin }).catch(() => {
      throw new ApiError(502, "Cloud upload failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const secureUrl = String(result?.secure_url || "").trim();

  if (!secureUrl) {
    return uploadToLocalDisk({ payload, requestOrigin });
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
    storage: "cloudinary",
  };
};

module.exports = {
  uploadAsset,
};
