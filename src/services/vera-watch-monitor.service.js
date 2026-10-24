const mongoose = require("mongoose");
const env = require("../config/env");
const { runWatches } = require("./vera-watch.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/** Checks what Vera is watching: resale prices and hosts' next events. */
const runVeraWatchMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await runWatches({});
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[VeraWatchMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startVeraWatchMonitor = () => {
  if (intervalHandle || !env.veraWatchMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runVeraWatchMonitorTick();
  }, env.veraWatchMonitorTickMs);

  void runVeraWatchMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[VeraWatchMonitor] Started (tick=${env.veraWatchMonitorTickMs}ms)`);
};

const stopVeraWatchMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startVeraWatchMonitor,
  stopVeraWatchMonitor,
  runVeraWatchMonitorTick,
};
