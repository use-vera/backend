const ApiError = require("../utils/api-error");
const env = require("../config/env");
const AppNotification = require("../models/notification.model");
const DeviceToken = require("../models/device-token.model");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

const normalizePushToken = (value) => String(value || "").trim();

const isExpoPushToken = (token) =>
  /^ExponentPushToken\[[^\]]+\]$/.test(token) ||
  /^ExpoPushToken\[[^\]]+\]$/.test(token);

const sendExpoPushMessages = async (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (env.expoAccessToken) {
    headers.Authorization = `Bearer ${env.expoAccessToken}`;
  }

  let response;

  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });
  } catch (error) {
    throw new ApiError(502, "Could not reach Expo push service", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(502, "Expo push request failed", {
      statusCode: response.status,
      payload,
      rawText,
    });
  }

  if (!payload || !Array.isArray(payload.data)) {
    throw new ApiError(502, "Invalid Expo push response", {
      payload,
      rawText,
    });
  }

  return payload.data;
};

const registerDeviceToken = async ({
  userId,
  pushToken,
  platform = "unknown",
  deviceId = "",
  appVersion = "",
}) => {
  const normalizedToken = normalizePushToken(pushToken);

  if (!normalizedToken || !isExpoPushToken(normalizedToken)) {
    throw new ApiError(400, "Invalid Expo push token");
  }

  const normalizedPlatform =
    platform === "ios" || platform === "android" ? platform : "unknown";

  const token = await DeviceToken.findOneAndUpdate(
    {
      pushToken: normalizedToken,
    },
    {
      $set: {
        userId,
        platform: normalizedPlatform,
        deviceId: String(deviceId || "").trim(),
        appVersion: String(appVersion || "").trim(),
        lastRegisteredAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  return token;
};

const unregisterDeviceToken = async ({ userId, pushToken }) => {
  const normalizedToken = normalizePushToken(pushToken);

  if (normalizedToken) {
    const result = await DeviceToken.deleteOne({
      userId,
      pushToken: normalizedToken,
    });

    return {
      removed: Number(result.deletedCount || 0),
    };
  }

  const result = await DeviceToken.deleteMany({ userId });

  return {
    removed: Number(result.deletedCount || 0),
  };
};

const sendPushToUser = async ({ userId, title, message, data = {} }) => {
  const tokens = await DeviceToken.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(30)
    .lean();

  if (!tokens.length) {
    return {
      attempted: 0,
      sent: 0,
      staleTokensRemoved: 0,
    };
  }

  const validTokens = tokens.filter((item) => isExpoPushToken(item.pushToken));

  if (!validTokens.length) {
    return {
      attempted: 0,
      sent: 0,
      staleTokensRemoved: 0,
    };
  }

  const messages = validTokens.map((item) => ({
    to: item.pushToken,
    title,
    body: message,
    sound: "default",
    data,
  }));

  const tickets = await sendExpoPushMessages(messages);
  const staleTokens = [];
  let sent = 0;

  tickets.forEach((ticket, index) => {
    if (ticket?.status === "ok") {
      sent += 1;
      return;
    }

    const errorCode = String(ticket?.details?.error || "").trim();

    if (errorCode === "DeviceNotRegistered") {
      staleTokens.push(validTokens[index].pushToken);
    }
  });

  if (staleTokens.length) {
    await DeviceToken.deleteMany({
      pushToken: { $in: staleTokens },
    });
  }

  return {
    attempted: messages.length,
    sent,
    staleTokensRemoved: staleTokens.length,
  };
};

const createNotification = async ({
  userId,
  type,
  title,
  message,
  data = {},
  push = true,
}) => {
  const notification = await AppNotification.create({
    userId,
    type: String(type || "general").trim() || "general",
    title: String(title || "").trim(),
    message: String(message || "").trim(),
    data,
  });

  if (!push) {
    return {
      notification,
      pushResult: {
        attempted: 0,
        sent: 0,
        staleTokensRemoved: 0,
      },
    };
  }

  try {
    const pushResult = await sendPushToUser({
      userId,
      title: notification.title,
      message: notification.message,
      data: {
        ...(notification.data || {}),
        notificationId: String(notification._id),
      },
    });

    return {
      notification,
      pushResult,
    };
  } catch (error) {
    if (env.nodeEnv !== "production") {
      console.warn("[Notification Push Error]", {
        userId: String(userId),
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      notification,
      pushResult: {
        attempted: 0,
        sent: 0,
        staleTokensRemoved: 0,
      },
    };
  }
};

const listUserNotifications = async ({
  userId,
  page = 1,
  limit = 20,
  unreadOnly = false,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const query = {
    userId,
  };

  if (unreadOnly) {
    query.readAt = null;
  }

  const [items, totalItems, unreadCount] = await Promise.all([
    AppNotification.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    AppNotification.countDocuments(query),
    AppNotification.countDocuments({
      userId,
      readAt: null,
    }),
  ]);

  return {
    items,
    unreadCount,
    ...buildPaginationMeta({ page: safePage, limit: safeLimit, totalItems }),
  };
};

const markNotificationRead = async ({ userId, notificationId }) => {
  const notification = await AppNotification.findOneAndUpdate(
    {
      _id: notificationId,
      userId,
    },
    {
      $set: {
        readAt: new Date(),
      },
    },
    {
      new: true,
    },
  );

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  return notification;
};

const markAllNotificationsRead = async ({ userId }) => {
  const result = await AppNotification.updateMany(
    {
      userId,
      readAt: null,
    },
    {
      $set: {
        readAt: new Date(),
      },
    },
  );

  return {
    updated: Number(result.modifiedCount || 0),
  };
};

module.exports = {
  registerDeviceToken,
  unregisterDeviceToken,
  createNotification,
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
