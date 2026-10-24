const mongoose = require("mongoose");
const env = require("../config/env");
const { purgeDeletedAccounts } = require("./account-deletion.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/** Erases what is left of deleted accounts, a few at a time. */
const runAccountDeletionMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await purgeDeletedAccounts({});
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[AccountDeletionMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startAccountDeletionMonitor = () => {
  if (intervalHandle || !env.accountDeletionMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runAccountDeletionMonitorTick();
  }, env.accountDeletionMonitorTickMs);

  void runAccountDeletionMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[AccountDeletionMonitor] Started (tick=${env.accountDeletionMonitorTickMs}ms)`);
};

const stopAccountDeletionMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startAccountDeletionMonitor,
  stopAccountDeletionMonitor,
  runAccountDeletionMonitorTick,
};
