const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectIdSchema = z.string().trim().regex(objectIdRegex, "Invalid id format");

const registerDeviceTokenSchema = z.object({
  pushToken: z.string().trim().min(12).max(400),
  platform: z.enum(["ios", "android", "unknown"]).optional().default("unknown"),
  deviceId: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(80).optional(),
});

const unregisterDeviceTokenSchema = z.object({
  pushToken: z.string().trim().min(12).max(400).optional(),
});

const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  unreadOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") {
        return value;
      }

      const normalized = String(value || "").trim().toLowerCase();
      return ["1", "true", "yes", "on"].includes(normalized);
    }),
});

const notificationIdParamsSchema = z.object({
  notificationId: objectIdSchema,
});

const createTestNotificationSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  message: z.string().trim().min(2).max(600).optional(),
});

module.exports = {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  createTestNotificationSchema,
};
