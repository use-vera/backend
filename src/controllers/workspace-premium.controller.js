const asyncHandler = require("../utils/async-handler");
const {
  getWorkspaceBranding,
  updateWorkspaceBranding,
  listWorkspaceCampaigns,
  sendWorkspaceCampaign,
  createWorkspaceDataExport,
} = require("../services/workspace-premium.service");

const getWorkspaceBrandingController = asyncHandler(async (req, res) => {
  const result = await getWorkspaceBranding({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Workspace branding fetched",
    data: result,
  });
});

const updateWorkspaceBrandingController = asyncHandler(async (req, res) => {
  const result = await updateWorkspaceBranding({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Workspace branding updated",
    data: result,
  });
});

const listWorkspaceCampaignsController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceCampaigns({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    query: req.query,
  });

  res.status(200).json({
    success: true,
    message: "Workspace campaigns fetched",
    data: result,
  });
});

const sendWorkspaceCampaignController = asyncHandler(async (req, res) => {
  const result = await sendWorkspaceCampaign({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Campaign sent",
    data: result,
  });
});

const createWorkspaceDataExportController = asyncHandler(async (req, res) => {
  const result = await createWorkspaceDataExport({
    workspaceRef: req.params.workspaceId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Export generated",
    data: result,
  });
});

module.exports = {
  getWorkspaceBrandingController,
  updateWorkspaceBrandingController,
  listWorkspaceCampaignsController,
  sendWorkspaceCampaignController,
  createWorkspaceDataExportController,
};
