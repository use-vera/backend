const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  createTestNotificationSchema,
} = require("../validations/notification.validation");
const {
  registerDeviceTokenController,
  unregisterDeviceTokenController,
  listMyNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
  createTestNotificationController,
} = require("../controllers/notification.controller");

const router = express.Router();

router.use(authMiddleware);

router.post(
  "/devices/register",
  validateBody(registerDeviceTokenSchema),
  registerDeviceTokenController,
);
router.post(
  "/devices/unregister",
  validateBody(unregisterDeviceTokenSchema),
  unregisterDeviceTokenController,
);
router.get(
  "/me",
  validateQuery(listNotificationsQuerySchema),
  listMyNotificationsController,
);
router.patch(
  "/me/read-all",
  markAllNotificationsReadController,
);
router.patch(
  "/me/:notificationId/read",
  validateParams(notificationIdParamsSchema),
  markNotificationReadController,
);
router.post(
  "/dev/test",
  validateBody(createTestNotificationSchema),
  createTestNotificationController,
);

module.exports = router;
