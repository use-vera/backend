const asyncHandler = require("../utils/async-handler");
const {
  createWorkspace,
  listUserWorkspaces,
  getWorkspaceDetails,
  updateWorkspace,
  requestJoinWorkspace,
  listJoinRequests,
  reviewJoinRequest,
  listWorkspaceMembers,
  getWorkspaceMemberDetails,
  updateMemberRole,
} = require("../services/workspace.service");

const createWorkspaceController = asyncHandler(async (req, res) => {
  const result = await createWorkspace({
    ownerUserId: req.auth.userId,
    ...req.body,
  });

  res.status(201).json({
    success: true,
    message: "Workspace created",
    data: result,
  });
});

const listWorkspacesController = asyncHandler(async (req, res) => {
  const result = await listUserWorkspaces(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Workspaces fetched",
    data: result,
  });
});

const getWorkspaceController = asyncHandler(async (req, res) => {
  const result = await getWorkspaceDetails(
    req.params.workspaceId,
    req.auth.userId,
  );

  res.status(200).json({
    success: true,
    message: "Workspace details fetched",
    data: result,
  });
});

const updateWorkspaceController = asyncHandler(async (req, res) => {
  const result = await updateWorkspace(
    req.params.workspaceId,
    req.auth.userId,
    req.body,
  );

  res.status(200).json({
    success: true,
    message: "Workspace updated",
    data: result,
  });
});

const requestJoinWorkspaceController = asyncHandler(async (req, res) => {
  const result = await requestJoinWorkspace(
    req.params.workspaceId,
    req.auth.userId,
    req.body.message,
  );

  res.status(201).json({
    success: true,
    message: "Join request submitted",
    data: result,
  });
});

const listJoinRequestsController = asyncHandler(async (req, res) => {
  const result = await listJoinRequests(
    req.params.workspaceId,
    req.auth.userId,
  );

  res.status(200).json({
    success: true,
    message: "Join requests fetched",
    data: result,
  });
});

const approveJoinRequestController = asyncHandler(async (req, res) => {
  const result = await reviewJoinRequest({
    workspaceId: req.params.workspaceId,
    requestId: req.params.requestId,
    reviewerUserId: req.auth.userId,
    action: "approve",
  });

  res.status(200).json({
    success: true,
    message: "Join request approved",
    data: result,
  });
});

const rejectJoinRequestController = asyncHandler(async (req, res) => {
  const result = await reviewJoinRequest({
    workspaceId: req.params.workspaceId,
    requestId: req.params.requestId,
    reviewerUserId: req.auth.userId,
    action: "reject",
  });

  res.status(200).json({
    success: true,
    message: "Join request rejected",
    data: result,
  });
});

const listMembersController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceMembers(req.params.workspaceId, req.auth.userId, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    role: req.query.role,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "Members fetched",
    data: result,
  });
});

const getMemberDetailsController = asyncHandler(async (req, res) => {
  const result = await getWorkspaceMemberDetails({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    targetUserId: req.params.memberId,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Member details fetched",
    data: result,
  });
});

const updateMemberRoleController = asyncHandler(async (req, res) => {
  const result = await updateMemberRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    targetUserId: req.params.memberId,
    role: req.body.role,
  });

  res.status(200).json({
    success: true,
    message: "Member role updated",
    data: result,
  });
});

const promoteMemberToAdminController = asyncHandler(async (req, res) => {
  const result = await updateMemberRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    targetUserId: req.params.memberId,
    role: "admin",
  });

  res.status(200).json({
    success: true,
    message: "Member promoted to admin",
    data: result,
  });
});

module.exports = {
  createWorkspaceController,
  listWorkspacesController,
  getWorkspaceController,
  updateWorkspaceController,
  requestJoinWorkspaceController,
  listJoinRequestsController,
  approveJoinRequestController,
  rejectJoinRequestController,
  listMembersController,
  getMemberDetailsController,
  updateMemberRoleController,
  promoteMemberToAdminController,
};
