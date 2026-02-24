const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const objectIdSchema = z
  .string()
  .regex(objectIdRegex, "Invalid id format");
const workspaceRefSchema = z
  .string()
  .trim()
  .regex(workspaceRefRegex, "Invalid workspace reference");

const workspaceAttendancePayloadSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(10000),
  location: z.string().trim().min(1).max(300),
  geofence: z.string().trim().min(1).max(200),
  method: z.string().trim().max(120).optional(),
  deviceHint: z.string().trim().max(120).optional(),
});

const attendanceLogParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
  logId: objectIdSchema,
});

const dateQuerySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });

const attendanceLogsQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).optional().default("mine"),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(25),
  search: z.string().trim().max(120).optional(),
  type: z.enum(["check-in", "check-out"]).optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

module.exports = {
  workspaceAttendancePayloadSchema,
  attendanceLogParamsSchema,
  attendanceLogsQuerySchema,
};
