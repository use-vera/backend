const mongoose = require("mongoose");
const env = require("../config/env");
const { releaseDueResaleSales } = require("./resale-payout.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/** Pays out resales whose hold has ended, and checks on transfers in flight. */
const runResalePayoutMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await releaseDueResaleSales({});
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ResalePayoutMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startResalePayoutMonitor = () => {
  if (intervalHandle || !env.resalePayoutMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runResalePayoutMonitorTick();
  }, env.resalePayoutMonitorTickMs);

  void runResalePayoutMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[ResalePayoutMonitor] Started (tick=${env.resalePayoutMonitorTickMs}ms)`);
};

const stopResalePayoutMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startResalePayoutMonitor,
  stopResalePayoutMonitor,
  runResalePayoutMonitorTick,
};
