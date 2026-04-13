const AttendanceLog = require("../models/attendance-log.model");
const AttendanceSession = require("../models/attendance-session.model");
const Workspace = require("../models/workspace.model");
const mongoose = require("mongoose");
const env = require("../config/env");
const { createNotification } = require("./notification.service");

const MONITOR_TICK_MS = Math.max(10 * 1000, Number(env.presenceMonitorTickMs || 60 * 1000));
const TRANSIENT_LOG_WINDOW_MS = 30 * 1000;

let intervalHandle = null;
let isTickRunning = false;
let transientFailureCount = 0;
let lastTransientLogAt = 0;

const toRadians = (value) => (value * Math.PI) / 180;

const isDbConnected = () => mongoose.connection.readyState === 1;

const isTransientMongoConnectivityError = (error) => {
  if (!error) {
    return false;
  }

  const name = String(error.name || "");
  const message = String(error.message || "");
  const causeMessage = String(error.cause?.message || "");
  const reasonType = String(error.reason?.type || "");
  const combined = `${message} ${causeMessage} ${reasonType}`.toLowerCase();

  if (
    name === "MongoServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError"
  ) {
    return true;
  }

  return [
    "econnreset",
    "etimedout",
    "econnrefused",
    "ehostunreach",
    "enotfound",
    "eai_again",
    "replicasetnoprimary",
    "server selection timed out",
  ].some((token) => combined.includes(token));
};

const logTransientFailure = (error) => {
  transientFailureCount += 1;
  const now = Date.now();

  if (now - lastTransientLogAt < TRANSIENT_LOG_WINDOW_MS) {
    return;
  }

  lastTransientLogAt = now;

  const briefMessage = String(
    error?.cause?.message ||
      error?.message ||
      "Transient database connectivity error",
  );

  // eslint-disable-next-line no-console
  console.warn(
    `[PresenceMonitor] Tick skipped due to transient DB issue (${briefMessage}). failures=${transientFailureCount}`,
  );
};

const logRecoveryIfNeeded = () => {
  if (!transientFailureCount) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[PresenceMonitor] Recovered after ${transientFailureCount} transient DB failures`,
  );

  transientFailureCount = 0;
  lastTransientLogAt = 0;
};

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

const resolvePresencePolicy = (workspace) => {
  const policy = workspace.presencePolicy || {};

  return {
    enabled: policy.enabled !== false,
    intervalMinutes: Number(policy.intervalMinutes || 60),
    maxConsecutiveMisses: Math.max(2, Number(policy.maxConsecutiveMisses || 2)),
  };
};

const isFiniteNumber = (value) => Number.isFinite(value);

const evaluateSessionSignal = ({ session, workspace, intervalMinutes, now }) => {
  const intervalMs = intervalMinutes * 60 * 1000;

  const lastSeenAt = session.lastSeenAt ? new Date(session.lastSeenAt) : null;

  if (!lastSeenAt) {
    return {
      withinRange: false,
      reason: "No recent location signal",
      distanceMeters: null,
      kind: "missing-signal",
    };
  }

  const freshnessMs = now.getTime() - lastSeenAt.getTime();

  if (freshnessMs > intervalMs * 1.1) {
    return {
      withinRange: false,
      reason: "Location heartbeat is stale",
      distanceMeters: null,
      kind: "stale-signal",
    };
  }

  const hasSessionCoords =
    isFiniteNumber(session.lastSeenLatitude) &&
    isFiniteNumber(session.lastSeenLongitude);

  const hasFenceCoords =
    isFiniteNumber(workspace.geofence?.latitude) &&
    isFiniteNumber(workspace.geofence?.longitude);

  if (!hasSessionCoords || !hasFenceCoords) {
    return {
      withinRange: false,
      reason: "Missing geofence signal coordinates",
      distanceMeters: null,
      kind: "missing-coordinates",
    };
  }

  const distanceMeters = getDistanceMeters(
    {
      latitude: workspace.geofence.latitude,
      longitude: workspace.geofence.longitude,
    },
    {
      latitude: session.lastSeenLatitude,
      longitude: session.lastSeenLongitude,
    },
  );

  const radius = Number(workspace.geofence?.radiusMeters || 0);
  const withinRange = radius <= 0 ? true : distanceMeters <= radius;

  return {
    withinRange,
    reason: withinRange ? "Within verification zone" : "Outside verification zone",
    distanceMeters,
    kind: withinRange ? "within-zone" : "outside-zone",
  };
};

const shouldCountSignalAsMiss = ({ session, signal }) => {
  if (signal.kind === "outside-zone") {
    return true;
  }

  // If we only lost heartbeat while the last known signal was still in range,
  // keep the user checked in and wait for the next strong signal.
  if (
    signal.kind === "stale-signal" ||
    signal.kind === "missing-signal" ||
    signal.kind === "missing-coordinates"
  ) {
    return session.lastSeenWithinGeofence === false;
  }

  return false;
};

const notifyImpendingAutoCheckout = async ({
  session,
  workspace,
  signal,
  policy,
  now,
}) => {
  const nextCheckAt = new Date(
    now.getTime() + policy.intervalMinutes * 60 * 1000,
  );

  try {
    await createNotification({
      userId: session.userId,
      type: "attendance.auto_checkout_warning",
      title: "Return to your check-in zone",
      message: `You're outside ${workspace.name}. Return before the next verification to avoid automatic check-out.`,
      push: true,
      data: {
        target: "check-in",
        workspaceId: String(workspace._id),
        reason: signal.reason,
        intervalMinutes: policy.intervalMinutes,
        nextCheckAt: nextCheckAt.toISOString(),
      },
    });
  } catch (_error) {
    // Do not fail the monitor tick if notification write/push fails.
  }
};

const notifyAutoCheckoutCompleted = async ({ session, workspace, signal, now }) => {
  try {
    await createNotification({
      userId: session.userId,
      type: "attendance.auto_checked_out",
      title: "You were checked out automatically",
      message: `${workspace.name} ended your active check-in because you were out of range.`,
      push: true,
      data: {
        target: "check-in",
        workspaceId: String(workspace._id),
        reason: signal.reason,
        checkedOutAt: now.toISOString(),
      },
    });
  } catch (_error) {
    // Do not fail the monitor tick if notification write/push fails.
  }
};

const shouldEvaluateSession = ({ session, intervalMinutes, now }) => {
  const intervalMs = intervalMinutes * 60 * 1000;

  const anchor =
    session.lastMonitorCheckAt || session.checkedInAt || session.updatedAt || session.createdAt;

  if (!anchor) {
    return true;
  }

  return now.getTime() - new Date(anchor).getTime() >= intervalMs;
};

const createAutoCheckoutLog = async ({ session, workspace, signal, now }) => {
  const fallbackLat = isFiniteNumber(workspace.geofence?.latitude)
    ? workspace.geofence.latitude
    : 0;
  const fallbackLng = isFiniteNumber(workspace.geofence?.longitude)
    ? workspace.geofence.longitude
    : 0;

  const latitude = isFiniteNumber(session.lastSeenLatitude)
    ? session.lastSeenLatitude
    : fallbackLat;
  const longitude = isFiniteNumber(session.lastSeenLongitude)
    ? session.lastSeenLongitude
    : fallbackLng;

  await AttendanceLog.create({
    workspaceId: session.workspaceId,
    userId: session.userId,
    type: "check-out",
    timestamp: now,
    location:
      session.lastSeenLocation ||
      workspace.geofence?.address ||
      workspace.geofence?.name ||
      workspace.name,
    method: "Presence Monitor (Auto Checkout)",
    status: "verified",
    latitude,
    longitude,
    accuracyMeters: session.lastSeenAccuracyMeters || 200,
    geofence: `${workspace.geofence?.name || workspace.name} · ${workspace.geofence?.radiusMeters || 0}m`,
    deviceHint: "System auto checkout",
  });

  session.status = "checked-out";
  session.checkedOutAt = now;
  session.autoCheckoutReason = `${signal.reason} for ${session.consecutiveMisses} checks`;
  session.lastAutoCheckoutWarningAt = null;
  session.lastAutoCheckoutWarningMissCount = 0;
};

const runPresenceMonitorTick = async () => {
  if (isTickRunning) {
    return;
  }

  if (!isDbConnected()) {
    return;
  }

  isTickRunning = true;

  try {
    const now = new Date();
    const sessions = await AttendanceSession.find({ status: "checked-in" });

    if (!sessions.length) {
      return;
    }

    const workspaceIds = [...new Set(sessions.map((item) => String(item.workspaceId)))];
    const workspaces = await Workspace.find({ _id: { $in: workspaceIds } });

    const workspaceById = new Map(
      workspaces.map((workspace) => [String(workspace._id), workspace]),
    );

    for (const session of sessions) {
      const workspace = workspaceById.get(String(session.workspaceId));

      if (!workspace) {
        continue;
      }

      const policy = resolvePresencePolicy(workspace);

      if (!policy.enabled) {
        continue;
      }

      if (!shouldEvaluateSession({ session, intervalMinutes: policy.intervalMinutes, now })) {
        continue;
      }

      const signal = evaluateSessionSignal({
        session,
        workspace,
        intervalMinutes: policy.intervalMinutes,
        now,
      });

      session.lastMonitorCheckAt = now;

      if (signal.withinRange) {
        session.consecutiveMisses = 0;
        session.autoCheckoutReason = "";
        session.lastAutoCheckoutWarningAt = null;
        session.lastAutoCheckoutWarningMissCount = 0;
        await session.save();
        continue;
      }

      const shouldCountAsMiss = shouldCountSignalAsMiss({ session, signal });

      if (!shouldCountAsMiss) {
        session.consecutiveMisses = 0;
        session.autoCheckoutReason = signal.reason;
        session.lastAutoCheckoutWarningAt = null;
        session.lastAutoCheckoutWarningMissCount = 0;
        await session.save();
        continue;
      }

      session.consecutiveMisses = Number(session.consecutiveMisses || 0) + 1;
      const warningThreshold = Math.max(1, policy.maxConsecutiveMisses - 1);

      if (
        session.consecutiveMisses >= warningThreshold &&
        session.consecutiveMisses < policy.maxConsecutiveMisses &&
        Number(session.lastAutoCheckoutWarningMissCount || 0) <
          session.consecutiveMisses
      ) {
        await notifyImpendingAutoCheckout({
          session,
          workspace,
          signal,
          policy,
          now,
        });
        session.lastAutoCheckoutWarningAt = now;
        session.lastAutoCheckoutWarningMissCount = session.consecutiveMisses;
      }

      if (session.consecutiveMisses >= policy.maxConsecutiveMisses) {
        await createAutoCheckoutLog({
          session,
          workspace,
          signal,
          now,
        });
        await notifyAutoCheckoutCompleted({
          session,
          workspace,
          signal,
          now,
        });
      } else {
        session.autoCheckoutReason = signal.reason;
      }

      await session.save();
    }
    logRecoveryIfNeeded();
  } catch (error) {
    if (isTransientMongoConnectivityError(error)) {
      logTransientFailure(error);
    } else {
      // eslint-disable-next-line no-console
      console.error("[PresenceMonitor] Tick failed", error);
    }
  } finally {
    isTickRunning = false;
  }
};

const startPresenceMonitor = () => {
  if (!env.presenceMonitorEnabled) {
    // eslint-disable-next-line no-console
    console.log("[PresenceMonitor] Disabled via PRESENCE_MONITOR_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runPresenceMonitorTick();
  }, MONITOR_TICK_MS);

  // Kick off shortly after startup.
  setTimeout(() => {
    void runPresenceMonitorTick();
  }, 2500);
};

const stopPresenceMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
};

module.exports = {
  startPresenceMonitor,
  stopPresenceMonitor,
  runPresenceMonitorTick,
};
