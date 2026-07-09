const ApiError = require("../utils/api-error");
const { hashApiKeySecret } = require("../utils/api-key");
const { PUBLISHABLE_ALLOWED_SCOPES } = require("../config/api-scopes");
const ApiKey = require("../models/api-key.model");

const apiKeyAuthMiddleware = async (req, _res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      throw new ApiError(401, "API key is required", null, "UNAUTHORIZED");
    }

    const rawKey = authorization.slice(7).trim();
    let apiKey;
    let effectiveScopes;
    let keyType;

    if (rawKey.startsWith("pk_")) {
      apiKey = await ApiKey.findOne({ publishableKey: rawKey, status: "active" });
      keyType = "publishable";
      effectiveScopes = PUBLISHABLE_ALLOWED_SCOPES;
    } else if (rawKey.startsWith("sk_")) {
      apiKey = await ApiKey.findOne({
        secretKeyHash: hashApiKeySecret(rawKey),
        status: "active",
      }).select("+secretKeyHash");
      keyType = "secret";
      effectiveScopes = apiKey?.scopes || [];
    } else {
      throw new ApiError(401, "Malformed API key", null, "UNAUTHORIZED");
    }

    if (!apiKey) {
      throw new ApiError(401, "Invalid API key", null, "UNAUTHORIZED");
    }

    req.apiAuth = {
      apiKeyId: String(apiKey._id),
      workspaceId: String(apiKey.workspaceId),
      mode: apiKey.mode,
      scopes: effectiveScopes,
      keyType,
    };

    // Fire-and-forget — a lastUsedAt write failure must never block the
    // actual request.
    ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date() } }).catch(
      () => {},
    );

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = apiKeyAuthMiddleware;
