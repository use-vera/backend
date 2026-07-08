const mongoose = require("mongoose");
const env = require("../config/env");
const { runSettlementTick } = require("./wallet-settlement.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runWalletSettlementMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await runSettlementTick({});
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[WalletSettlementMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startWalletSettlementMonitor = () => {
  if (intervalHandle || !env.walletSettlementMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runWalletSettlementMonitorTick();
  }, env.walletSettlementMonitorTickMs);

  void runWalletSettlementMonitorTick();

  // eslint-disable-next-line no-console
  console.log(
    `[WalletSettlementMonitor] Started (tick=${env.walletSettlementMonitorTickMs}ms)`,
  );
};

const stopWalletSettlementMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startWalletSettlementMonitor,
  stopWalletSettlementMonitor,
  runWalletSettlementMonitorTick,
};
