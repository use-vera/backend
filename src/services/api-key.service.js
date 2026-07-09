const ApiError = require("../utils/api-error");
const ApiKey = require("../models/api-key.model");
const { generateApiKeyPair } = require("../utils/api-key");
const { requireWorkspaceRole } = require("./workspace.service");

const createApiKey = async ({ workspaceRef, actorUserId, label, mode, scopes }) => {
  const { workspace } = await requireWorkspaceRole(workspaceRef, actorUserId, "admin");
  const { publishableKey, secretKey, secretKeyHash, secretKeyLastFour } =
    generateApiKeyPair(mode);

  const apiKey = await ApiKey.create({
    workspaceId: workspace._id,
    mode,
    label: label || "",
    publishableKey,
    secretKeyHash,
    secretKeyLastFour,
    scopes,
    createdByUserId: actorUserId,
  });

  const json = apiKey.toJSON();

  return {
    ...json,
    // Shown exactly once — never retrievable again after this response.
    secretKey,
  };
};

const listApiKeys = async ({ workspaceRef, actorUserId }) => {
  const { workspace } = await requireWorkspaceRole(workspaceRef, actorUserId, "admin");

  const keys = await ApiKey.find({ workspaceId: workspace._id }).sort({ createdAt: -1 });

  return keys.map((key) => key.toJSON());
};

const updateApiKey = async ({ workspaceRef, actorUserId, keyId, updates }) => {
  const { workspace } = await requireWorkspaceRole(workspaceRef, actorUserId, "admin");

  const apiKey = await ApiKey.findOne({ _id: keyId, workspaceId: workspace._id });

  if (!apiKey) {
    throw new ApiError(404, "API key not found");
  }

  if (updates.label !== undefined) {
    apiKey.label = updates.label;
  }

  if (updates.scopes !== undefined) {
    apiKey.scopes = updates.scopes;
  }

  await apiKey.save();

  return apiKey.toJSON();
};

/**
 * "live"/"test" is baked into the actual pk_/sk_ prefix, not just a status
 * flag — so promoting a key can't just flip a field, it has to regenerate
 * the key material. Keeps the same record (_id, label, scopes, usage
 * history) and issues a fresh secret, which the caller must re-reveal to
 * the user exactly like a brand-new key.
 */
const upgradeApiKeyToLive = async ({ workspaceRef, actorUserId, keyId }) => {
  const { workspace } = await requireWorkspaceRole(workspaceRef, actorUserId, "admin");

  const apiKey = await ApiKey.findOne({ _id: keyId, workspaceId: workspace._id });

  if (!apiKey) {
    throw new ApiError(404, "API key not found");
  }

  if (apiKey.status === "revoked") {
    throw new ApiError(409, "This key is revoked and can't be upgraded");
  }

  if (apiKey.mode === "live") {
    throw new ApiError(409, "This key is already live");
  }

  const { publishableKey, secretKey, secretKeyHash, secretKeyLastFour } =
    generateApiKeyPair("live");

  apiKey.mode = "live";
  apiKey.publishableKey = publishableKey;
  apiKey.secretKeyHash = secretKeyHash;
  apiKey.secretKeyLastFour = secretKeyLastFour;
  await apiKey.save();

  return {
    ...apiKey.toJSON(),
    // Shown exactly once — never retrievable again after this response.
    secretKey,
  };
};

const revokeApiKey = async ({ workspaceRef, actorUserId, keyId }) => {
  const { workspace } = await requireWorkspaceRole(workspaceRef, actorUserId, "admin");

  const apiKey = await ApiKey.findOne({ _id: keyId, workspaceId: workspace._id });

  if (!apiKey) {
    throw new ApiError(404, "API key not found");
  }

  if (apiKey.status === "revoked") {
    return apiKey.toJSON();
  }

  apiKey.status = "revoked";
  apiKey.revokedAt = new Date();
  apiKey.revokedByUserId = actorUserId;
  await apiKey.save();

  return apiKey.toJSON();
};

module.exports = {
  createApiKey,
  listApiKeys,
  updateApiKey,
  upgradeApiKeyToLive,
  revokeApiKey,
};
