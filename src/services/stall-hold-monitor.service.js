const mongoose = require("mongoose");
const env = require("../config/env");
const { releaseLapsedStallHolds } = require("./event-vendor.service");

/**
 * Gives back spots whose stall fee was never paid in time.
 *
 * The lists an organizer and a vendor read already release lapsed holds as
 * they go, which covers the common case. This exists for the one that
 * matters most: nobody opens either page for a day, and an unpaid hold sits
 * on a spot the organizer could have sold.
 */
let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runStallHoldMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const released = await releaseLapsedStallHolds();

    if (released > 0) {
      // eslint-disable-next-line no-console
      console.log(`[StallHoldMonitor] Released ${released} unpaid stall(s)`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[StallHoldMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startStallHoldMonitor = () => {
  if (intervalHandle || !env.stallHoldMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runStallHoldMonitorTick();
  }, env.stallHoldMonitorTickMs);

  void runStallHoldMonitorTick();

  // eslint-disable-next-line no-console
  console.log(
    `[StallHoldMonitor] Started (tick=${env.stallHoldMonitorTickMs}ms)`,
  );
};

const stopStallHoldMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  runStallHoldMonitorTick,
  startStallHoldMonitor,
  stopStallHoldMonitor,
};
