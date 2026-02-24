const asyncHandler = require("../utils/async-handler");
const {
  createWorkspaceInvite,
  listWorkspaceInvites,
  listMyInvites,
  respondToInvite,
} = require("../services/invite.service");

const createWorkspaceInviteController = asyncHandler(async (req, res) => {
  const result = await createWorkspaceInvite({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    email: req.body.email,
    role: req.body.role,
    message: req.body.message,
  });

  res.status(201).json({
    success: true,
    message: "Invite sent",
    data: result,
  });
});

const listWorkspaceInvitesController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceInvites(
    req.params.workspaceId,
    req.auth.userId,
  );

  res.status(200).json({
    success: true,
    message: "Workspace invites fetched",
    data: result,
  });
});

const listMyInvitesController = asyncHandler(async (req, res) => {
  const result = await listMyInvites(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Your invites fetched",
    data: result,
  });
});

const acceptInviteController = asyncHandler(async (req, res) => {
  const result = await respondToInvite({
    inviteId: req.params.inviteId,
    userId: req.auth.userId,
    action: "accept",
  });

  res.status(200).json({
    success: true,
    message: "Invite accepted",
    data: result,
  });
});

const declineInviteController = asyncHandler(async (req, res) => {
  const result = await respondToInvite({
    inviteId: req.params.inviteId,
    userId: req.auth.userId,
    action: "decline",
  });

  res.status(200).json({
    success: true,
    message: "Invite declined",
    data: result,
  });
});

module.exports = {
  createWorkspaceInviteController,
  listWorkspaceInvitesController,
  listMyInvitesController,
  acceptInviteController,
  declineInviteController,
};
