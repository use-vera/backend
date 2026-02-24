const ApiError = require("../utils/api-error");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const AttendanceLog = require("../models/attendance-log.model");
const AttendanceSession = require("../models/attendance-session.model");
const {
  syncRecurringPresenceFromSignal,
} = require("./recurring-event.service");

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

const toDateBoundary = (input, endOfDay = false) => {
  const raw = String(input || "").trim();
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
  }

  return date;
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

const getDistanceMeters = (origin, target) => {
  const toRadians = (value) => (value * Math.PI) / 180;

  const earthRadius = 6371000;
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(target.latitude);
  const deltaLat = toRadians(target.latitude - origin.latitude);
  const deltaLon = toRadians(target.longitude - origin.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadius * c);
};

const computeGeofenceSignal = (workspace, payload) => {
  const center = workspace.geofence || {};
  const hasCenter =
    Number.isFinite(center.latitude) && Number.isFinite(center.longitude);
  const hasPoint =
    Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude);

  if (!hasCenter || !hasPoint) {
    return {
      withinGeofence: true,
      distanceMeters: null,
    };
  }

  const radius = Number(center.radiusMeters || 0);
  const distanceMeters = getDistanceMeters(
    { latitude: center.latitude, longitude: center.longitude },
    { latitude: payload.latitude, longitude: payload.longitude },
  );

  return {
    withinGeofence: radius <= 0 ? true : distanceMeters <= radius,
    distanceMeters,
  };
};

const createAttendanceLog = async ({
  workspaceId,
  userId,
  type,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "member");
  const workspaceObjectId = workspace._id;

  const lastLog = await AttendanceLog.findOne({
    workspaceId: workspaceObjectId,
    userId,
  }).sort({
    timestamp: -1,
    createdAt: -1,
  });

  if (type === "check-in" && lastLog?.type === "check-in") {
    throw new ApiError(409, "You are already checked in");
  }

  if (type === "check-out") {
    if (!lastLog || lastLog.type !== "check-in") {
      throw new ApiError(409, "No active check-in found for check-out");
    }
  }

  const { withinGeofence } = computeGeofenceSignal(workspace, payload);

  const log = await AttendanceLog.create({
    workspaceId: workspaceObjectId,
    userId,
    type,
    timestamp: new Date(),
    location: payload.location,
    method: payload.method || "GPS + Device Biometrics",
    status: "verified",
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyMeters: payload.accuracyMeters,
    geofence: payload.geofence,
    deviceHint: payload.deviceHint || "Mobile device",
  });

  if (type === "check-in") {
    await AttendanceSession.findOneAndUpdate(
      {
        workspaceId: workspaceObjectId,
        userId,
        status: "checked-in",
      },
      {
        $set: {
          status: "checked-in",
          checkedInAt: new Date(),
          checkedOutAt: null,
          lastSeenAt: new Date(),
          lastSeenLatitude: payload.latitude,
          lastSeenLongitude: payload.longitude,
          lastSeenAccuracyMeters: payload.accuracyMeters,
          lastSeenLocation: payload.location,
          lastSeenWithinGeofence: withinGeofence,
          consecutiveMisses: 0,
          lastMonitorCheckAt: new Date(),
          autoCheckoutReason: "",
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } else {
    await AttendanceSession.findOneAndUpdate(
      {
        workspaceId: workspaceObjectId,
        userId,
        status: "checked-in",
      },
      {
        $set: {
          status: "checked-out",
          checkedOutAt: new Date(),
          lastSeenAt: new Date(),
          lastSeenLatitude: payload.latitude,
          lastSeenLongitude: payload.longitude,
          lastSeenAccuracyMeters: payload.accuracyMeters,
          lastSeenLocation: payload.location,
          lastSeenWithinGeofence: withinGeofence,
          consecutiveMisses: 0,
          lastMonitorCheckAt: new Date(),
          autoCheckoutReason: "",
        },
      },
      {
        new: true,
      },
    );
  }

  await syncRecurringPresenceFromSignal({
    workspaceId: workspaceObjectId,
    userId,
    at: new Date(),
    latitude: payload.latitude,
    longitude: payload.longitude,
  });

  return log;
};

const pingAttendanceSession = async ({
  workspaceId,
  userId,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "member");
  const workspaceObjectId = workspace._id;

  const activeSession = await AttendanceSession.findOne({
    workspaceId: workspaceObjectId,
    userId,
    status: "checked-in",
  });

  if (!activeSession) {
    throw new ApiError(409, "No active check-in session found");
  }

  const signal = computeGeofenceSignal(workspace, payload);

  activeSession.lastSeenAt = new Date();
  activeSession.lastSeenLatitude = payload.latitude;
  activeSession.lastSeenLongitude = payload.longitude;
  activeSession.lastSeenAccuracyMeters = payload.accuracyMeters;
  activeSession.lastSeenLocation = payload.location;
  activeSession.lastSeenWithinGeofence = signal.withinGeofence;
  activeSession.consecutiveMisses = signal.withinGeofence
    ? 0
    : activeSession.consecutiveMisses;
  await activeSession.save();

  await syncRecurringPresenceFromSignal({
    workspaceId: workspaceObjectId,
    userId,
    at: new Date(),
    latitude: payload.latitude,
    longitude: payload.longitude,
  });

  return {
    session: activeSession,
    withinGeofence: signal.withinGeofence,
    distanceMeters: signal.distanceMeters,
  };
};

const listAttendanceLogs = async ({
  workspaceId,
  userId,
  scope,
  page = 1,
  limit = 25,
  search,
  type,
  from,
  to,
}) => {
  const { membership, workspace } = await requireWorkspaceRole(
    workspaceId,
    userId,
    "member",
  );

  const query = { workspaceId: workspace._id };

  if (scope === "all") {
    if (membership.role === "member") {
      throw new ApiError(403, "Only admin roles can view all workspace logs");
    }
  } else {
    query.userId = userId;
  }

  if (type) {
    query.type = type;
  }

  const fromDate = from ? toDateBoundary(from) : null;
  const toDate = to ? toDateBoundary(to, true) : null;

  if (fromDate && toDate && fromDate > toDate) {
    throw new ApiError(400, "'from' date cannot be greater than 'to' date");
  }

  if (fromDate || toDate) {
    query.timestamp = {};

    if (fromDate) {
      query.timestamp.$gte = fromDate;
    }

    if (toDate) {
      query.timestamp.$lte = toDate;
    }
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const searchPattern = new RegExp(escapeRegex(trimmedSearch), "i");

    query.$or = [
      { location: searchPattern },
      { geofence: searchPattern },
      { method: searchPattern },
      { deviceHint: searchPattern },
    ];
  }

  const skip = (page - 1) * limit;

  const [items, totalItems] = await Promise.all([
    AttendanceLog.find(query)
      .populate("userId", "fullName email title")
      .sort({ timestamp: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AttendanceLog.countDocuments(query),
  ]);

  return {
    items,
    ...buildPaginationMeta({ page, limit, totalItems }),
  };
};

const getAttendanceLogById = async ({ workspaceId, userId, logId }) => {
  const { membership, workspace } = await requireWorkspaceRole(
    workspaceId,
    userId,
    "member",
  );

  const log = await AttendanceLog.findOne({
    _id: logId,
    workspaceId: workspace._id,
  }).populate("userId", "fullName email title");

  if (!log) {
    throw new ApiError(404, "Attendance log not found");
  }

  const logUserId = String(log.userId?._id || log.userId);

  if (membership.role === "member" && logUserId !== String(userId)) {
    throw new ApiError(403, "You can only view your own attendance logs");
  }

  return log;
};

module.exports = {
  createAttendanceLog,
  pingAttendanceSession,
  listAttendanceLogs,
  getAttendanceLogById,
};
