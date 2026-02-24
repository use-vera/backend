const ApiError = require("../utils/api-error");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const RecurringEvent = require("../models/recurring-event.model");
const RecurringEventAttendance = require("../models/recurring-event-attendance.model");

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

const toMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(":").map((value) => Number(value));
  return hours * 60 + minutes;
};

const dayNumber = (value) => {
  const date = new Date(value);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      (24 * 60 * 60 * 1000),
  );
};

const monthNumber = (value) => {
  const date = new Date(value);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

const isOccurrenceDay = (event, now) => {
  const interval = Number(event.interval || 1);

  if (event.frequency === "daily") {
    return (dayNumber(now) - dayNumber(event.createdAt)) % interval === 0;
  }

  if (event.frequency === "weekly") {
    const allowedDays = event.daysOfWeek?.length
      ? event.daysOfWeek
      : [new Date(event.createdAt).getUTCDay()];

    if (!allowedDays.includes(now.getUTCDay())) {
      return false;
    }

    const weekDiff = Math.floor((dayNumber(now) - dayNumber(event.createdAt)) / 7);
    return weekDiff % interval === 0;
  }

  if (event.frequency === "monthly") {
    const day = Number(event.dayOfMonth || new Date(event.createdAt).getUTCDate());

    if (now.getUTCDate() !== day) {
      return false;
    }

    return (monthNumber(now) - monthNumber(event.createdAt)) % interval === 0;
  }

  return false;
};

const isWithinEventWindow = (event, now) => {
  const startMinutes = toMinutes(event.startTime);
  const endMinutes = toMinutes(event.endTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }

  // Overnight window, e.g. 22:00 -> 03:00
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
};

const toRadians = (value) => (value * Math.PI) / 180;

const getDistanceMeters = (origin, target) => {
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

const isFiniteNumber = (value) => Number.isFinite(value);

const resolveEventGeofence = (event, workspace) => {
  const override = event.geofenceOverride || {};

  if (
    isFiniteNumber(override.latitude) &&
    isFiniteNumber(override.longitude) &&
    isFiniteNumber(override.radiusMeters)
  ) {
    return {
      latitude: override.latitude,
      longitude: override.longitude,
      radiusMeters: override.radiusMeters,
    };
  }

  return {
    latitude: workspace.geofence?.latitude,
    longitude: workspace.geofence?.longitude,
    radiusMeters: workspace.geofence?.radiusMeters,
  };
};

const validateEventPayload = (payload) => {
  if (payload.frequency === "weekly" && (!payload.daysOfWeek || payload.daysOfWeek.length === 0)) {
    throw new ApiError(400, "Weekly recurring event requires daysOfWeek");
  }

  if (payload.frequency === "monthly" && !payload.dayOfMonth) {
    throw new ApiError(400, "Monthly recurring event requires dayOfMonth");
  }

  if (payload.startTime === payload.endTime) {
    throw new ApiError(400, "Start and end time cannot be the same");
  }

  const override = payload.geofenceOverride;

  if (override) {
    const hasAny =
      override.latitude !== undefined ||
      override.longitude !== undefined ||
      override.radiusMeters !== undefined;

    const hasAll =
      override.latitude !== undefined &&
      override.longitude !== undefined &&
      override.radiusMeters !== undefined;

    if (hasAny && !hasAll) {
      throw new ApiError(
        400,
        "Geofence override requires latitude, longitude, and radiusMeters",
      );
    }
  }
};

const createRecurringEvent = async ({ workspaceId, actorUserId, payload }) => {
  const { workspace } = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );
  validateEventPayload(payload);

  return RecurringEvent.create({
    workspaceId: workspace._id,
    createdByUserId: actorUserId,
    name: payload.name,
    description: payload.description || "",
    frequency: payload.frequency,
    interval: payload.interval,
    daysOfWeek: payload.daysOfWeek,
    dayOfMonth: payload.dayOfMonth || null,
    startTime: payload.startTime,
    endTime: payload.endTime,
    timezone: payload.timezone || "Africa/Lagos",
    geofenceOverride: payload.geofenceOverride || {
      latitude: null,
      longitude: null,
      radiusMeters: null,
    },
    enabled: payload.enabled !== false,
  });
};

const listRecurringEvents = async ({ workspaceId, userId }) => {
  const { workspace } = await requireWorkspaceRole(workspaceId, userId, "member");

  return RecurringEvent.find({ workspaceId: workspace._id }).sort({ createdAt: -1 });
};

const updateRecurringEvent = async ({
  workspaceId,
  actorUserId,
  eventId,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );

  const event = await RecurringEvent.findOne({
    _id: eventId,
    workspaceId: workspace._id,
  });

  if (!event) {
    throw new ApiError(404, "Recurring event not found");
  }

  const nextPayload = {
    frequency: payload.frequency || event.frequency,
    daysOfWeek: payload.daysOfWeek || event.daysOfWeek,
    dayOfMonth:
      payload.dayOfMonth !== undefined ? payload.dayOfMonth : event.dayOfMonth,
    startTime: payload.startTime || event.startTime,
    endTime: payload.endTime || event.endTime,
    geofenceOverride:
      payload.geofenceOverride !== undefined
        ? payload.geofenceOverride
        : event.geofenceOverride,
  };

  validateEventPayload(nextPayload);

  Object.assign(event, payload);
  await event.save();

  return event;
};

const listRecurringEventAttendance = async ({
  workspaceId,
  actorUserId,
  eventId,
  date,
  limit,
}) => {
  const { workspace } = await requireWorkspaceRole(
    workspaceId,
    actorUserId,
    "admin",
  );

  const query = {
    workspaceId: workspace._id,
    recurringEventId: eventId,
  };

  if (date) {
    query.dateKey = date;
  }

  return RecurringEventAttendance.find(query)
    .populate("userId", "fullName email title")
    .sort({ updatedAt: -1 })
    .limit(limit || 80);
};

const syncRecurringPresenceFromSignal = async ({
  workspaceId,
  userId,
  at,
  latitude,
  longitude,
}) => {
  const now = at ? new Date(at) : new Date();

  const [workspace, events] = await Promise.all([
    Workspace.findById(workspaceId),
    RecurringEvent.find({ workspaceId, enabled: true }),
  ]);

  if (!workspace || !events.length) {
    return;
  }

  const hasPoint = isFiniteNumber(latitude) && isFiniteNumber(longitude);

  if (!hasPoint) {
    return;
  }

  const dateKey = now.toISOString().slice(0, 10);

  for (const event of events) {
    if (!isOccurrenceDay(event, now) || !isWithinEventWindow(event, now)) {
      continue;
    }

    const geofence = resolveEventGeofence(event, workspace);

    if (
      !isFiniteNumber(geofence.latitude) ||
      !isFiniteNumber(geofence.longitude) ||
      !isFiniteNumber(geofence.radiusMeters)
    ) {
      continue;
    }

    const distanceMeters = getDistanceMeters(
      {
        latitude: geofence.latitude,
        longitude: geofence.longitude,
      },
      {
        latitude,
        longitude,
      },
    );

    const withinRange = distanceMeters <= geofence.radiusMeters;

    const attendance =
      (await RecurringEventAttendance.findOne({
        recurringEventId: event._id,
        workspaceId,
        userId,
        dateKey,
      })) ||
      new RecurringEventAttendance({
        recurringEventId: event._id,
        workspaceId,
        userId,
        dateKey,
      });

    const previousStatus = attendance.status;

    attendance.lastSeenAt = now;
    attendance.lastLatitude = latitude;
    attendance.lastLongitude = longitude;
    attendance.lastDistanceMeters = distanceMeters;

    if (withinRange) {
      attendance.status = "present";

      if (!attendance.firstEnteredAt) {
        attendance.firstEnteredAt = now;
      }
    } else {
      attendance.status = "absent";

      if (previousStatus === "present") {
        attendance.lastExitedAt = now;
      }
    }

    await attendance.save();
  }
};

module.exports = {
  createRecurringEvent,
  listRecurringEvents,
  updateRecurringEvent,
  listRecurringEventAttendance,
  syncRecurringPresenceFromSignal,
};
