const ApiError = require("../utils/api-error");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const User = require("../models/user.model");
const WorkspaceInvite = require("../models/workspace-invite.model");

const roleWeight = {
  member: 1,
  admin: 2,
  owner: 3,
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const normalizeWorkspaceRef = (workspaceRef) =>
  String(workspaceRef || "").trim().toLowerCase();

const resolveWorkspaceByRef = async (workspaceRef) => {
  const normalized = normalizeWorkspaceRef(workspaceRef);

  if (!normalized) {
    throw new ApiError(400, "Workspace reference is required");
  }

  if (objectIdRegex.test(normalized)) {
    const byId = await Workspace.findById(normalized);

    if (byId) {
      return byId;
    }
  }

  const bySlug = await Workspace.findOne({ slug: normalized });

  if (!bySlug) {
    throw new ApiError(404, "Workspace not found");
  }

  return bySlug;
};

const getMembership = (workspaceId, userId) =>
  Membership.findOne({ workspaceId, userId, status: "active" });

const requireWorkspaceRole = async (workspaceRef, userId, minRole = "member") => {
  const workspace = await resolveWorkspaceByRef(workspaceRef);
  const membership = await getMembership(workspace._id, userId);

  if (!membership) {
    throw new ApiError(403, "You are not an active member of this workspace");
  }

  if (roleWeight[membership.role] < roleWeight[minRole]) {
    throw new ApiError(403, "Insufficient permission for this action");
  }

  return {
    membership,
    workspace,
  };
};

const createWorkspaceInvite = async ({
  workspaceId,
  actorUserId,
  email,
  role,
  message = "",
}) => {
  const actorContext = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );
  const { membership: actorMembership, workspace } = actorContext;
  const workspaceObjectId = workspace._id;

  if (role === "admin" && actorMembership.role !== "owner") {
    throw new ApiError(403, "Only workspace owner can invite admins");
  }

  const invitedEmail = email.trim().toLowerCase();

  const existingInvite = await WorkspaceInvite.findOne({
    workspaceId: workspaceObjectId,
    invitedEmail,
    status: "pending",
  });

  if (existingInvite) {
    throw new ApiError(409, "A pending invite for this email already exists");
  }

  const existingUser = await User.findOne({ email: invitedEmail });

  if (existingUser) {
    const existingMembership = await Membership.findOne({
      workspaceId: workspaceObjectId,
      userId: existingUser._id,
    });

    if (existingMembership?.status === "active") {
      throw new ApiError(409, "This user is already an active workspace member");
    }

    if (existingMembership) {
      existingMembership.status = "invited";
      existingMembership.role = role;
      await existingMembership.save();
    } else {
      await Membership.create({
        workspaceId: workspaceObjectId,
        userId: existingUser._id,
        role,
        status: "invited",
      });
    }
  }

  const invite = await WorkspaceInvite.create({
    workspaceId: workspaceObjectId,
    invitedEmail,
    role,
    message,
    invitedByUserId: actorUserId,
    status: "pending",
  });

  return WorkspaceInvite.findById(invite._id)
    .populate("invitedByUserId", "fullName email")
    .populate("workspaceId", "name slug");
};

const listWorkspaceInvites = async (workspaceId, userId) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "admin");

  return WorkspaceInvite.find({ workspaceId: workspace._id, status: "pending" })
    .populate("invitedByUserId", "fullName email")
    .sort({ createdAt: -1 });
};

const listMyInvites = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  return WorkspaceInvite.find({ invitedEmail: user.email, status: "pending" })
    .populate("workspaceId", "name slug description geofence")
    .populate("invitedByUserId", "fullName email")
    .sort({ createdAt: -1 });
};

const respondToInvite = async ({ inviteId, userId, action }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  const invite = await WorkspaceInvite.findById(inviteId);

  if (!invite) {
    throw new ApiError(404, "Invite not found");
  }

  if (invite.status !== "pending") {
    throw new ApiError(409, "Invite has already been processed");
  }

  if (invite.invitedEmail !== user.email) {
    throw new ApiError(403, "This invite is not addressed to your account");
  }

  const workspace = await Workspace.findById(invite.workspaceId);

  if (!workspace) {
    throw new ApiError(404, "Workspace no longer exists");
  }

  if (action === "accept") {
    const existingMembership = await Membership.findOne({
      workspaceId: invite.workspaceId,
      userId,
    });

    if (existingMembership?.status === "active") {
      throw new ApiError(409, "You are already an active workspace member");
    }

    await Membership.findOneAndUpdate(
      { workspaceId: invite.workspaceId, userId },
      {
        $set: {
          role: invite.role,
          status: "active",
          joinedAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    invite.status = "accepted";
    invite.respondedByUserId = userId;
    invite.respondedAt = new Date();
    await invite.save();

    return {
      invite,
      workspace,
    };
  }

  invite.status = "declined";
  invite.respondedByUserId = userId;
  invite.respondedAt = new Date();
  await invite.save();

  await Membership.findOneAndUpdate(
    {
      workspaceId: invite.workspaceId,
      userId,
      status: "invited",
    },
    {
      $set: {
        status: "rejected",
        role: "member",
      },
    },
  );

  return {
    invite,
    workspace,
  };
};

module.exports = {
  createWorkspaceInvite,
  listWorkspaceInvites,
  listMyInvites,
  respondToInvite,
};
