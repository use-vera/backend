const asyncHandler = require("../utils/async-handler");
const {
  createApiKey,
  listApiKeys,
  updateApiKey,
  upgradeApiKeyToLive,
  revokeApiKey,
} = require("../services/api-key.service");

const createApiKeyController = asyncHandler(async (req, res) => {
  const result = await createApiKey({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    label: req.body.label,
    mode: req.body.mode,
    scopes: req.body.scopes,
  });

  res.status(201).json({
    success: true,
    message: "API key created",
    data: result,
  });
});

const listApiKeysController = asyncHandler(async (req, res) => {
  const result = await listApiKeys({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "API keys fetched",
    data: result,
  });
});

const updateApiKeyController = asyncHandler(async (req, res) => {
  const result = await updateApiKey({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    keyId: req.params.keyId,
    updates: req.body,
  });

  res.status(200).json({
    success: true,
    message: "API key updated",
    data: result,
  });
});

const upgradeApiKeyToLiveController = asyncHandler(async (req, res) => {
  const result = await upgradeApiKeyToLive({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    keyId: req.params.keyId,
  });

  res.status(200).json({
    success: true,
    message: "API key upgraded to live",
    data: result,
  });
});

const revokeApiKeyController = asyncHandler(async (req, res) => {
  const result = await revokeApiKey({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    keyId: req.params.keyId,
  });

  res.status(200).json({
    success: true,
    message: "API key revoked",
    data: result,
  });
});

module.exports = {
  createApiKeyController,
  listApiKeysController,
  updateApiKeyController,
  upgradeApiKeyToLiveController,
  revokeApiKeyController,
};
