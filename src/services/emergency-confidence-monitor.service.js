const mongoose = require("mongoose");
const env = require("../config/env");
const EventEmergency = require("../models/event-emergency.model");
const {
  recomputeEmergencyConfidence,
  archiveStaleResolvedEmergencies,
} = require("./emergency.service");

const MONITOR_TICK_MS = Math.max(
  5 * 1000,
  Number(env.emergencyMonitorTickMs || 15 * 1000),
);

let intervalHandle = null;
let isTickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Confidence must decay over wall-clock time even when no new reports
 * arrive — without this periodic tick, a score would only ever update on
 * report arrival and could get stuck at a stale high value forever once
 * reports stop coming in, which is wrong (recency-decayed signals need a
 * clock, not just events).
 */
const runEmergencyConfidenceMonitorTick = async () => {
  if (isTickRunning || !isDbConnected()) {
    return;
  }

  isTickRunning = true;

  try {
    const activeEmergencies = await EventEmergency.find({ isActive: true }).select("_id");

    for (const item of activeEmergencies) {
      try {
        await recomputeEmergencyConfidence(item._id);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[EmergencyConfidenceMonitor] Recompute failed", {
          emergencyId: String(item._id),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await archiveStaleResolvedEmergencies();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EmergencyConfidenceMonitor] Tick failed", error);
  } finally {
    isTickRunning = false;
  }
};

const startEmergencyConfidenceMonitor = () => {
  if (!env.emergencyMonitorEnabled) {
    // eslint-disable-next-line no-console
    console.log("[EmergencyConfidenceMonitor] Disabled via EMERGENCY_MONITOR_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runEmergencyConfidenceMonitorTick();
  }, MONITOR_TICK_MS);

  setTimeout(() => {
    void runEmergencyConfidenceMonitorTick();
  }, 2500);
};

const stopEmergencyConfidenceMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
};

module.exports = {
  startEmergencyConfidenceMonitor,
  stopEmergencyConfidenceMonitor,
  runEmergencyConfidenceMonitorTick,
};
