const mongoose = require("mongoose");
const env = require("../config/env");
const { processWaitlists } = require("./event-waitlist.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/** Tells people on waitlists when spots open. */
const runWaitlistMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await processWaitlists({});
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[WaitlistMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startWaitlistMonitor = () => {
  if (intervalHandle || !env.waitlistMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runWaitlistMonitorTick();
  }, env.waitlistMonitorTickMs);

  void runWaitlistMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[WaitlistMonitor] Started (tick=${env.waitlistMonitorTickMs}ms)`);
};

const stopWaitlistMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startWaitlistMonitor,
  stopWaitlistMonitor,
  runWaitlistMonitorTick,
};
