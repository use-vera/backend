const mongoose = require("mongoose");
const env = require("../config/env");
const { sendPendingDirectMessageNudges } = require("./chat.service");

const TICK_MS = Math.max(
  60 * 1000,
  Number(env.chatReminderTickMs || 5 * 60 * 1000),
);
const DELAY_MINUTES = Math.max(
  1,
  Number(env.chatReminderDelayMinutes || 120),
);

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runChatReminderTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const result = await sendPendingDirectMessageNudges({
      delayMinutes: DELAY_MINUTES,
    });

    if (env.nodeEnv !== "production" && result.sent > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[ChatReminder] Sent ${result.sent} reminder(s) after ${DELAY_MINUTES} minutes`,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ChatReminder] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startChatReminderMonitor = () => {
  if (!env.chatReminderEnabled) {
    // eslint-disable-next-line no-console
    console.log("[ChatReminder] Disabled via CHAT_REMINDER_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runChatReminderTick();
  }, TICK_MS);

  void runChatReminderTick();

  // eslint-disable-next-line no-console
  console.log(
    `[ChatReminder] Started (tick=${TICK_MS}ms, delay=${DELAY_MINUTES}m)`,
  );
};

const stopChatReminderMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startChatReminderMonitor,
  stopChatReminderMonitor,
  runChatReminderTick,
};
