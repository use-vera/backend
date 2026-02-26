const asyncHandler = require("../utils/async-handler");
const {
  registerDeviceToken,
  unregisterDeviceToken,
  createNotification,
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../services/notification.service");

const registerDeviceTokenController = asyncHandler(async (req, res) => {
  const token = await registerDeviceToken({
    userId: req.auth.userId,
    pushToken: req.body.pushToken,
    platform: req.body.platform,
    deviceId: req.body.deviceId,
    appVersion: req.body.appVersion,
  });

  res.status(200).json({
    success: true,
    message: "Device token registered",
    data: token,
  });
});

const unregisterDeviceTokenController = asyncHandler(async (req, res) => {
  const result = await unregisterDeviceToken({
    userId: req.auth.userId,
    pushToken: req.body.pushToken,
  });

  res.status(200).json({
    success: true,
    message: "Device token removed",
    data: result,
  });
});

const listMyNotificationsController = asyncHandler(async (req, res) => {
  const result = await listUserNotifications({
    userId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    unreadOnly: req.query.unreadOnly,
  });

  res.status(200).json({
    success: true,
    message: "Notifications fetched",
    data: result,
  });
});

const markNotificationReadController = asyncHandler(async (req, res) => {
  const notification = await markNotificationRead({
    userId: req.auth.userId,
    notificationId: req.params.notificationId,
  });

  res.status(200).json({
    success: true,
    message: "Notification marked as read",
    data: notification,
  });
});

const markAllNotificationsReadController = asyncHandler(async (req, res) => {
  const result = await markAllNotificationsRead({
    userId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "All notifications marked as read",
    data: result,
  });
});

const createTestNotificationController = asyncHandler(async (req, res) => {
  const title =
    String(req.body.title || "").trim() || "Test notification";
  const message =
    String(req.body.message || "").trim() ||
    "This is a test alert from Vera.";

  const result = await createNotification({
    userId: req.auth.userId,
    type: "dev.test",
    title,
    message,
    data: {
      target: "notifications",
      generatedAt: new Date().toISOString(),
    },
    push: true,
  });

  res.status(201).json({
    success: true,
    message: "Test notification sent",
    data: result.notification,
  });
});

module.exports = {
  registerDeviceTokenController,
  unregisterDeviceTokenController,
  listMyNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
  createTestNotificationController,
};
