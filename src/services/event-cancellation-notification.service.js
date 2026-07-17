const env = require("../config/env");
const AppNotification = require("../models/notification.model");
const DeviceToken = require("../models/device-token.model");
const { sendExpoPushMessages, isExpoPushToken } = require("./notification.service");

// Expo's push API hard-caps a single request at 100 messages.
const EXPO_BATCH_SIZE = 100;

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Generic bulk fanout for "notify every affected attendee of this event
 * about something" — same mechanics as emergency-notification.service.js's
 * broadcastEmergencyAlert (bulk AppNotification insert + chunked Expo push),
 * kept separate from that function since it's emergency-shaped (hardcoded
 * type/data/realtime event) and this one is generic.
 */
const notifyEventCancelled = async ({ recipientUserIds, title, message, data = {} }) => {
  if (!recipientUserIds.length) {
    return { recipientCount: 0, pushAttempted: 0, pushSent: 0 };
  }

  await AppNotification.insertMany(
    recipientUserIds.map((userId) => ({
      userId,
      type: "event.cancelled",
      title,
      message,
      data,
    })),
  );

  const tokens = await DeviceToken.find({ userId: { $in: recipientUserIds } }).lean();
  const validTokens = tokens.filter((token) => isExpoPushToken(token.pushToken));

  let pushAttempted = 0;
  let pushSent = 0;

  for (const batch of chunk(validTokens, EXPO_BATCH_SIZE)) {
    const messages = batch.map((token) => ({
      to: token.pushToken,
      title,
      body: message,
      sound: "default",
      data,
    }));

    pushAttempted += messages.length;

    try {
      const tickets = await sendExpoPushMessages(messages);
      pushSent += tickets.filter((ticket) => ticket?.status === "ok").length;
    } catch (error) {
      if (env.nodeEnv !== "production") {
        console.warn("[EventCancellationNotification] Push batch failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    recipientCount: recipientUserIds.length,
    pushAttempted,
    pushSent,
  };
};

module.exports = {
  notifyEventCancelled,
};
