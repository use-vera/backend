const bcrypt = require("bcryptjs");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const User = require("../models/user.model");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const AttendanceLog = require("../models/attendance-log.model");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeWorkspaceRef = (workspaceRef) =>
  String(workspaceRef || "").trim().toLowerCase();

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const sanitizeUser = (userDocument) => {
  if (!userDocument) return null;

  const user = userDocument.toObject ? userDocument.toObject() : userDocument;
  delete user.passwordHash;
  delete user.__v;
  return user;
};

const normalizePreferences = (preferences = {}) => ({
  trackOnlyActiveHours: preferences.trackOnlyActiveHours !== false,
  activeHoursStart: Number.isInteger(preferences.activeHoursStart)
    ? preferences.activeHoursStart
    : 8,
  activeHoursEnd: Number.isInteger(preferences.activeHoursEnd)
    ? preferences.activeHoursEnd
    : 18,
  quietCheckIn: preferences.quietCheckIn === true,
  weeklyDigest: preferences.weeklyDigest !== false,
  themePreference:
    preferences.themePreference === "light" ||
    preferences.themePreference === "dark"
      ? preferences.themePreference
      : "system",
});

const resolveWorkspaceByRef = async (workspaceRef) => {
  const normalized = normalizeWorkspaceRef(workspaceRef);

  if (!normalized) {
    return null;
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

const ensureWorkspaceMember = async ({ workspaceId, userId }) => {
  const membership = await Membership.findOne({
    workspaceId,
    userId,
    status: "active",
  });

  if (!membership) {
    throw new ApiError(403, "You are not a member of this workspace");
  }
};

const buildReportRange = ({ period = "weekly", from, to }) => {
  const now = new Date();

  if (period === "custom") {
    const fromDate = startOfDay(from);
    const toDate = endOfDay(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new ApiError(400, "Invalid report date range");
    }

    if (fromDate > toDate) {
      throw new ApiError(400, "'from' cannot be later than 'to'");
    }

    return {
      fromDate,
      toDate,
    };
  }

  if (period === "monthly") {
    return {
      fromDate: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      toDate: now,
    };
  }

  return {
    fromDate: startOfDay(new Date(now.getTime() - 6 * DAY_MS)),
    toDate: now,
  };
};

const toDayKey = (value) => new Date(value).toISOString().slice(0, 10);

const formatHourMinute = (minutesInDay) => {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutesInDay)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const getUserProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  return sanitizeUser(user);
};

const updateUserProfile = async (userId, payload) => {
  const user = await User.findByIdAndUpdate(userId, payload, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  return sanitizeUser(user);
};

const getUserPreferences = async (userId) => {
  const user = await User.findById(userId).select("preferences");

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  return normalizePreferences(user.preferences);
};

const updateUserPreferences = async (userId, payload) => {
  const update = {};

  if (payload.trackOnlyActiveHours !== undefined) {
    update["preferences.trackOnlyActiveHours"] = payload.trackOnlyActiveHours;
  }

  if (payload.activeHoursStart !== undefined) {
    update["preferences.activeHoursStart"] = payload.activeHoursStart;
  }

  if (payload.activeHoursEnd !== undefined) {
    update["preferences.activeHoursEnd"] = payload.activeHoursEnd;
  }

  if (payload.quietCheckIn !== undefined) {
    update["preferences.quietCheckIn"] = payload.quietCheckIn;
  }

  if (payload.weeklyDigest !== undefined) {
    update["preferences.weeklyDigest"] = payload.weeklyDigest;
  }

  if (payload.themePreference !== undefined) {
    update["preferences.themePreference"] = payload.themePreference;
  }

  if (Object.keys(update).length === 0) {
    throw new ApiError(400, "No preferences update payload provided");
  }

  if (
    (payload.activeHoursStart !== undefined &&
      payload.activeHoursStart === payload.activeHoursEnd) ||
    (payload.activeHoursEnd !== undefined &&
      payload.activeHoursStart === payload.activeHoursEnd)
  ) {
    throw new ApiError(400, "activeHoursStart and activeHoursEnd cannot be the same");
  }

  const user = await User.findByIdAndUpdate(userId, { $set: update }, {
    new: true,
    runValidators: true,
  }).select("preferences");

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  return normalizePreferences(user.preferences);
};

const getUserAttendanceReport = async ({
  userId,
  workspaceRef,
  period = "weekly",
  from,
  to,
}) => {
  const workspace = workspaceRef ? await resolveWorkspaceByRef(workspaceRef) : null;

  if (workspace) {
    await ensureWorkspaceMember({
      workspaceId: workspace._id,
      userId,
    });
  }

  const { fromDate, toDate } = buildReportRange({
    period,
    from,
    to,
  });

  const query = {
    userId,
    timestamp: {
      $gte: fromDate,
      $lte: toDate,
    },
  };

  if (workspace) {
    query.workspaceId = workspace._id;
  }

  const logs = await AttendanceLog.find(query)
    .populate("workspaceId", "name slug")
    .sort({ timestamp: 1, createdAt: 1 })
    .lean();

  const checkIns = logs.filter((log) => log.type === "check-in");
  const checkOuts = logs.filter((log) => log.type === "check-out");

  const dayMap = new Map();
  const workspaceMap = new Map();
  const checkInMinutes = [];

  for (const log of logs) {
    const stamp = new Date(log.timestamp);
    const dayKey = toDayKey(stamp);

    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        date: dayKey,
        checkIns: 0,
        checkOuts: 0,
        firstSeenAt: log.timestamp,
        lastSeenAt: log.timestamp,
        minutesPresent: 0,
        openCheckInAt: null,
      });
    }

    const dayEntry = dayMap.get(dayKey);

    if (new Date(dayEntry.firstSeenAt).getTime() > stamp.getTime()) {
      dayEntry.firstSeenAt = log.timestamp;
    }

    if (new Date(dayEntry.lastSeenAt).getTime() < stamp.getTime()) {
      dayEntry.lastSeenAt = log.timestamp;
    }

    if (log.type === "check-in") {
      dayEntry.checkIns += 1;

      if (!dayEntry.openCheckInAt) {
        dayEntry.openCheckInAt = log.timestamp;
      }

      checkInMinutes.push(stamp.getHours() * 60 + stamp.getMinutes());
    }

    if (log.type === "check-out") {
      dayEntry.checkOuts += 1;

      if (dayEntry.openCheckInAt) {
        const openedAt = new Date(dayEntry.openCheckInAt);
        const minutes = Math.max(
          0,
          Math.round((stamp.getTime() - openedAt.getTime()) / 60000),
        );
        dayEntry.minutesPresent += minutes;
        dayEntry.openCheckInAt = null;
      }
    }

    const workspaceId = String(log.workspaceId?._id || log.workspaceId || "");

    if (workspaceId) {
      const workspaceName =
        typeof log.workspaceId === "object"
          ? log.workspaceId.name || "Workspace"
          : "Workspace";

      if (!workspaceMap.has(workspaceId)) {
        workspaceMap.set(workspaceId, {
          workspaceId,
          workspaceName,
          checkIns: 0,
          checkOuts: 0,
          totalLogs: 0,
          daySet: new Set(),
        });
      }

      const workspaceEntry = workspaceMap.get(workspaceId);
      workspaceEntry.totalLogs += 1;
      workspaceEntry.daySet.add(dayKey);

      if (log.type === "check-in") {
        workspaceEntry.checkIns += 1;
      }

      if (log.type === "check-out") {
        workspaceEntry.checkOuts += 1;
      }
    }
  }

  for (const dayEntry of dayMap.values()) {
    if (!dayEntry.openCheckInAt) {
      continue;
    }

    const openedAt = new Date(dayEntry.openCheckInAt);
    const closeAt = Math.min(toDate.getTime(), Date.now());
    const minutes = Math.max(
      0,
      Math.round((closeAt - openedAt.getTime()) / 60000),
    );

    dayEntry.minutesPresent += minutes;
    dayEntry.openCheckInAt = null;
  }

  const daily = Array.from(dayMap.values())
    .map((entry) => ({
      date: entry.date,
      checkIns: entry.checkIns,
      checkOuts: entry.checkOuts,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      minutesPresent: entry.minutesPresent,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const workspaceBreakdown = Array.from(workspaceMap.values()).map((entry) => ({
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    checkIns: entry.checkIns,
    checkOuts: entry.checkOuts,
    totalLogs: entry.totalLogs,
    daysPresent: entry.daySet.size,
  }));

  const totalDaysInRange = Math.max(
    1,
    Math.ceil((endOfDay(toDate).getTime() - startOfDay(fromDate).getTime()) / DAY_MS),
  );
  const daysPresent = new Set(checkIns.map((log) => toDayKey(log.timestamp))).size;
  const totalMinutes = daily.reduce(
    (acc, item) => acc + Number(item.minutesPresent || 0),
    0,
  );
  const latestCheckInAt = checkIns.length ? checkIns[checkIns.length - 1].timestamp : null;
  const latestCheckOutAt = checkOuts.length ? checkOuts[checkOuts.length - 1].timestamp : null;
  const averageCheckInTime =
    checkInMinutes.length > 0
      ? formatHourMinute(
          checkInMinutes.reduce((acc, value) => acc + value, 0) /
            checkInMinutes.length,
        )
      : null;

  return {
    period,
    range: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
    workspace: workspace
      ? {
          _id: String(workspace._id),
          name: workspace.name,
          slug: workspace.slug,
        }
      : null,
    summary: {
      totalLogs: logs.length,
      checkIns: checkIns.length,
      checkOuts: checkOuts.length,
      daysPresent,
      attendanceRate: Number(((daysPresent / totalDaysInRange) * 100).toFixed(1)),
      averageCheckInTime,
      totalMinutes,
      averageDailyMinutes:
        daily.length > 0
          ? Math.round(totalMinutes / daily.length)
          : 0,
      latestCheckInAt,
      latestCheckOutAt,
    },
    daily,
    workspaceBreakdown,
  };
};

const updatePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select("+passwordHash");

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );

  if (!isCurrentPasswordValid) {
    throw new ApiError(401, "Current password is invalid");
  }

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);

  user.passwordHash = passwordHash;
  await user.save();

  return {
    message: "Password updated successfully",
  };
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  updatePassword,
  getUserPreferences,
  updateUserPreferences,
  getUserAttendanceReport,
};
