const mongoose = require("mongoose");
const { expireAbandonedFeatureSlots } = require("./featured-event.service");

const TICK_MS = 5 * 60 * 1000;
const ABANDONED_AFTER_MINUTES = 20;

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runFeaturedSlotMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await expireAbandonedFeatureSlots({
      olderThanMinutes: ABANDONED_AFTER_MINUTES,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[FeaturedSlotMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startFeaturedSlotMonitor = () => {
  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runFeaturedSlotMonitorTick();
  }, TICK_MS);

  void runFeaturedSlotMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[FeaturedSlotMonitor] Started (tick=${TICK_MS}ms)`);
};

const stopFeaturedSlotMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startFeaturedSlotMonitor,
  stopFeaturedSlotMonitor,
  runFeaturedSlotMonitorTick,
};
