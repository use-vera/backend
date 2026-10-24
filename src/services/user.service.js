const bcrypt = require("bcryptjs");
const { TOPIC_KEYS } = require("../constants/notification-topics");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const User = require("../models/user.model");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const AttendanceLog = require("../models/attendance-log.model");
const { syncUserSubscriptionState } = require("./subscription.service");

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
  shareActivityWithFollowers: preferences.shareActivityWithFollowers !== false,
  preferredCategoryIds: Array.isArray(preferences.preferredCategoryIds)
    ? preferences.preferredCategoryIds.map((id) => String(id))
    : [],
  marketingOptIn: preferences.marketingOptIn === true,
  notifications: Object.fromEntries(
    TOPIC_KEYS.map((topic) => [topic, preferences.notifications?.[topic] !== false]),
  ),
});

/* ---------- Handles ---------- */

/* 3–24 of a-z, 0-9, dot, underscore. No leading, trailing or doubled dot,
   so a handle can never look like a domain or a file path. */
const HANDLE_PATTERN = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{3,24}$/;

/* Names that would let someone pass as Vera itself or as a system account. */
const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "api",
  "help",
  "me",
  "mod",
  "moderator",
  "official",
  "root",
  "security",
  "settings",
  "support",
  "system",
  "team",
  "vera",
  "veraapp",
  "vera.app",
  "verahq",
]);

const normalizeHandle = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

/** Why a handle can't be used, or "" when its shape is fine. */
const describeHandleProblem = (handle) => {
  if (!HANDLE_PATTERN.test(handle)) {
    return "Use 3–24 letters, numbers, dots or underscores.";
  }

  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved.";
  }

  return "";
};

const buildHandleCandidates = (fullName) => {
  const parts = String(fullName || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return [];
  }

  const joined = parts.join("").slice(0, 20);
  const dotted = parts.join(".").slice(0, 20);
  const underscored = parts.join("_").slice(0, 20);
  const suffix = String(Math.floor(10 + Math.random() * 89));

  return [joined, dotted, underscored, `${joined}${suffix}`, `${parts[0]}.vera`]
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .filter((candidate) => !describeHandleProblem(candidate));
};

/**
 * Whether `handle` can be claimed by this user, plus up to three free
 * alternatives built from their name.
 */
const checkHandleAvailability = async ({ userId, handle: rawHandle }) => {
  const handle = normalizeHandle(rawHandle);
  const user = await User.findById(userId).select("fullName handle");

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  const problem = describeHandleProblem(handle);
  let available = !problem;

  if (available && user.handle !== handle) {
    available = !(await User.exists({ handle, _id: { $ne: user._id } }));
  }

  const candidates = buildHandleCandidates(user.fullName).filter(
    (candidate) => candidate !== handle,
  );
  const taken = await User.find({ handle: { $in: candidates } }).distinct(
    "handle",
  );
  const suggestions = candidates
    .filter((candidate) => !taken.includes(candidate))
    .slice(0, 3);

  return {
    handle,
    available,
    reason: problem || (available ? "" : "That handle is taken."),
    suggestions,
  };
};

/**
 * Marks onboarding finished. A handle is the one thing onboarding can't
 * finish without, so it's checked here rather than trusted from the app.
 */
const completeOnboarding = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  if (!user.handle) {
    throw new ApiError(
      400,
      "Pick a handle before finishing.",
      null,
      "HANDLE_REQUIRED",
    );
  }

  if (!user.onboardingCompletedAt) {
    user.onboardingCompletedAt = new Date();
    await user.save();
  }

  return sanitizeUser(user);
};

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

const getDayDiff = (leftDayKey, rightDayKey) => {
  const left = startOfDay(leftDayKey).getTime();
  const right = startOfDay(rightDayKey).getTime();
  return Math.round((left - right) / DAY_MS);
};

const computeStreaks = (dayKeys) => {
  if (!dayKeys.length) {
    return {
      currentStreakDays: 0,
      longestStreakDays: 0,
    };
  }

  const sorted = [...new Set(dayKeys)].sort(
    (a, b) => startOfDay(a).getTime() - startOfDay(b).getTime(),
  );

  let longest = 1;
  let running = 1;

  for (let index = 1; index < sorted.length; index += 1) {
    const diff = getDayDiff(sorted[index], sorted[index - 1]);

    if (diff === 1) {
      running += 1;
      longest = Math.max(longest, running);
      continue;
    }

    running = 1;
  }

  let current = 1;

  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const diff = getDayDiff(sorted[index], sorted[index - 1]);

    if (diff === 1) {
      current += 1;
      continue;
    }

    break;
  }

  return {
    currentStreakDays: current,
    longestStreakDays: longest,
  };
};

const getUserProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  await syncUserSubscriptionState({ user });

  return sanitizeUser(user);
};

const getUserSubscription = async (userId) => {
  const { subscription } = await syncUserSubscriptionState({
    userId,
  });

  return subscription;
};

const updateUserProfile = async (userId, payload) => {
  const update = { ...payload };

  if (update.handle !== undefined) {
    update.handle = normalizeHandle(update.handle);
    const problem = describeHandleProblem(update.handle);

    if (problem) {
      throw new ApiError(400, problem, null, "HANDLE_INVALID");
    }

    if (await User.exists({ handle: update.handle, _id: { $ne: userId } })) {
      throw new ApiError(409, "That handle is taken.", null, "HANDLE_TAKEN");
    }
  }

  let user;

  try {
    user = await User.findByIdAndUpdate(userId, update, {
      new: true,
      runValidators: true,
    });
  } catch (error) {
    /* The unique index is the real arbiter: two people can pass the
       availability check for the same handle, only one can save it. */
    if (error?.code === 11000 && error?.keyPattern?.handle) {
      throw new ApiError(409, "That handle is taken.", null, "HANDLE_TAKEN");
    }

    throw error;
  }

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

  if (payload.shareActivityWithFollowers !== undefined) {
    update["preferences.shareActivityWithFollowers"] =
      payload.shareActivityWithFollowers;
  }

  if (payload.preferredCategoryIds !== undefined) {
    update["preferences.preferredCategoryIds"] = payload.preferredCategoryIds;
  }

  if (payload.marketingOptIn !== undefined) {
    update["preferences.marketingOptIn"] = payload.marketingOptIn;
  }

  for (const topic of TOPIC_KEYS) {
    if (payload.notifications?.[topic] !== undefined) {
      update[`preferences.notifications.${topic}`] = payload.notifications[topic];
    }
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
  const streaks = computeStreaks(checkIns.map((log) => toDayKey(log.timestamp)));

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
      currentStreakDays: streaks.currentStreakDays,
      longestStreakDays: streaks.longestStreakDays,
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

  if (!user.passwordHash) {
    throw new ApiError(
      400,
      "This account signs in with an emailed code, so it has no password.",
      null,
      "PASSWORDLESS_ACCOUNT",
    );
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
  getUserSubscription,
  updateUserProfile,
  updatePassword,
  getUserPreferences,
  updateUserPreferences,
  getUserAttendanceReport,
  checkHandleAvailability,
  completeOnboarding,
};
