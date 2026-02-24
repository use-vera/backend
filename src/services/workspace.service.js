const ApiError = require("../utils/api-error");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const JoinRequest = require("../models/join-request.model");
const User = require("../models/user.model");
const AttendanceLog = require("../models/attendance-log.model");
const { makeWorkspaceSlug } = require("../utils/slug");

const roleWeight = {
  member: 1,
  admin: 2,
  owner: 3,
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const normalizeWorkspaceRef = (workspaceRef) =>
  String(workspaceRef || "").trim().toLowerCase();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

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

const getUniqueWorkspaceSlug = async (workspaceName) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = makeWorkspaceSlug(workspaceName);
    const existing = await Workspace.exists({ slug });

    if (!existing) {
      return slug;
    }
  }

  throw new ApiError(500, "Could not generate unique workspace slug");
};

const createWorkspace = async ({
  ownerUserId,
  name,
  description,
  geofence,
  presencePolicy,
}) => {
  const owner = await User.findById(ownerUserId);

  if (!owner) {
    throw new ApiError(404, "Owner user not found");
  }

  const slug = await getUniqueWorkspaceSlug(name);

  const workspace = await Workspace.create({
    name,
    slug,
    description: description || "",
    ownerUserId,
    geofence,
    presencePolicy,
  });

  const ownerMembership = await Membership.create({
    workspaceId: workspace._id,
    userId: ownerUserId,
    role: "owner",
    status: "active",
    joinedAt: new Date(),
  });

  return {
    workspace,
    ownerMembership,
  };
};

const listUserWorkspaces = async (userId) => {
  const memberships = await Membership.find({
    userId,
    status: { $in: ["active", "pending", "invited"] },
  })
    .populate("workspaceId")
    .sort({ updatedAt: -1 });

  return memberships
    .filter((membership) => Boolean(membership.workspaceId))
    .map((membership) => ({
      membership,
      workspace: membership.workspaceId,
    }));
};

const getWorkspaceDetails = async (workspaceId, userId) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "member");

  const members = await Membership.find({ workspaceId: workspace._id })
    .populate("userId")
    .sort({ createdAt: 1 });

  return {
    workspace,
    members,
  };
};

const updateWorkspace = async (workspaceId, userId, payload) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "admin");

  if (payload.name !== undefined) workspace.name = payload.name;
  if (payload.description !== undefined)
    workspace.description = payload.description;
  if (payload.geofence !== undefined) workspace.geofence = payload.geofence;
  if (payload.presencePolicy !== undefined)
    workspace.presencePolicy = payload.presencePolicy;

  await workspace.save();

  return workspace;
};

const requestJoinWorkspace = async (workspaceId, userId, message = "") => {
  const workspace = await resolveWorkspaceByRef(workspaceId);
  const workspaceObjectId = workspace._id;

  const existingMembership = await Membership.findOne({
    workspaceId: workspaceObjectId,
    userId,
  });

  if (existingMembership?.status === "active") {
    throw new ApiError(409, "You are already a workspace member");
  }

  const pendingJoinRequest = await JoinRequest.findOne({
    workspaceId: workspaceObjectId,
    userId,
    status: "pending",
  });

  if (pendingJoinRequest) {
    throw new ApiError(409, "A pending join request already exists");
  }

  const joinRequest = await JoinRequest.create({
    workspaceId: workspaceObjectId,
    userId,
    message,
    status: "pending",
  });

  if (existingMembership) {
    existingMembership.status = "pending";
    existingMembership.role = "member";
    await existingMembership.save();
  } else {
    await Membership.create({
      workspaceId: workspaceObjectId,
      userId,
      role: "member",
      status: "pending",
    });
  }

  return joinRequest;
};

const listJoinRequests = async (workspaceId, userId) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "admin");

  return JoinRequest.find({ workspaceId: workspace._id, status: "pending" })
    .populate("userId")
    .sort({ createdAt: -1 });
};

const reviewJoinRequest = async ({
  workspaceId,
  reviewerUserId,
  requestId,
  action,
}) => {
  const { workspace } = await requireWorkspaceRole(
    workspaceId,
    reviewerUserId,
    "admin",
  );

  const joinRequest = await JoinRequest.findOne({
    _id: requestId,
    workspaceId: workspace._id,
  });

  if (!joinRequest) {
    throw new ApiError(404, "Join request not found");
  }

  if (joinRequest.status !== "pending") {
    throw new ApiError(409, "Join request has already been reviewed");
  }

  const nextStatus = action === "approve" ? "accepted" : "rejected";

  joinRequest.status = nextStatus;
  joinRequest.reviewedByUserId = reviewerUserId;
  joinRequest.reviewedAt = new Date();
  await joinRequest.save();

  const memberStatus = action === "approve" ? "active" : "rejected";

  await Membership.findOneAndUpdate(
    { workspaceId: workspace._id, userId: joinRequest.userId },
    {
      $set: {
        role: "member",
        status: memberStatus,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  return joinRequest;
};

const listWorkspaceMembers = async (
  workspaceId,
  userId,
  {
    page = 1,
    limit = 20,
    search,
    role,
    status,
  } = {},
) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "member");

  const query = { workspaceId: workspace._id };

  if (role && role !== "all") {
    query.role = role;
  }

  if (status && status !== "all") {
    query.status = status;
  }

  const trimmedSearch = String(search || "").trim();
  const skip = (page - 1) * limit;

  if (trimmedSearch) {
    const searchPattern = new RegExp(escapeRegex(trimmedSearch), "i");
    const matchingUsers = await User.find({
      $or: [
        { fullName: searchPattern },
        { email: searchPattern },
        { title: searchPattern },
      ],
    })
      .select("_id")
      .limit(5000)
      .lean();

    const userIds = matchingUsers.map((user) => user._id);

    if (!userIds.length) {
      return {
        items: [],
        ...buildPaginationMeta({ page, limit, totalItems: 0 }),
      };
    }

    query.userId = { $in: userIds };
  }

  const [items, totalItems] = await Promise.all([
    Membership.find(query)
      .populate("userId")
      .sort({ createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit),
    Membership.countDocuments(query),
  ]);

  return {
    items,
    ...buildPaginationMeta({ page, limit, totalItems }),
  };
};

const getWorkspaceMemberDetails = async ({
  workspaceId,
  actorUserId,
  targetUserId,
  limit = 30,
}) => {
  const { workspace } = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );

  const membership = await Membership.findOne({
    workspaceId: workspace._id,
    userId: targetUserId,
  }).populate("userId");

  if (!membership) {
    throw new ApiError(404, "Member not found in this workspace");
  }

  const baseLogQuery = {
    workspaceId: workspace._id,
    userId: targetUserId,
  };

  const [
    totalEvents,
    checkIns,
    checkOuts,
    lastCheckIn,
    lastCheckOut,
    recentLogs,
  ] = await Promise.all([
    AttendanceLog.countDocuments(baseLogQuery),
    AttendanceLog.countDocuments({ ...baseLogQuery, type: "check-in" }),
    AttendanceLog.countDocuments({ ...baseLogQuery, type: "check-out" }),
    AttendanceLog.findOne({ ...baseLogQuery, type: "check-in" }).sort({
      timestamp: -1,
      createdAt: -1,
    }),
    AttendanceLog.findOne({ ...baseLogQuery, type: "check-out" }).sort({
      timestamp: -1,
      createdAt: -1,
    }),
    AttendanceLog.find(baseLogQuery)
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(limit),
  ]);

  const latestLog = recentLogs[0] ?? null;
  const isCurrentlyCheckedIn = latestLog?.type === "check-in";

  const minutesSinceLastCheckIn =
    isCurrentlyCheckedIn && lastCheckIn
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(lastCheckIn.timestamp).getTime()) / 60000),
        )
      : 0;

  return {
    membership,
    summary: {
      totalEvents,
      checkIns,
      checkOuts,
      isCurrentlyCheckedIn,
      minutesSinceLastCheckIn,
      lastCheckInAt: lastCheckIn?.timestamp ?? null,
      lastCheckOutAt: lastCheckOut?.timestamp ?? null,
    },
    recentLogs,
  };
};

const updateMemberRole = async ({
  workspaceId,
  actorUserId,
  targetUserId,
  role,
}) => {
  const actorContext = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );
  const { membership: actorMembership, workspace } = actorContext;

  const targetMembership = await Membership.findOne({
    workspaceId: workspace._id,
    userId: targetUserId,
    status: "active",
  }).populate("userId");

  if (!targetMembership) {
    throw new ApiError(404, "Target member not found in workspace");
  }

  if (targetMembership.role === "owner") {
    throw new ApiError(409, "Owner role cannot be modified");
  }

  if (role === "admin" && actorMembership.role !== "owner") {
    throw new ApiError(403, "Only workspace owner can promote admins");
  }

  targetMembership.role = role;
  await targetMembership.save();

  return targetMembership;
};

module.exports = {
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
};
