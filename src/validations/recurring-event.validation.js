const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
const workspaceRefSchema = z
  .string()
  .trim()
  .regex(workspaceRefRegex, "Invalid workspace reference");

const timeStringRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const geofenceOverrideSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusMeters: z.number().int().min(10).max(5000).optional(),
  })
  .optional();

const createRecurringEventSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  interval: z.number().int().min(1).max(30).optional().default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  startTime: z.string().regex(timeStringRegex, "Invalid start time format"),
  endTime: z.string().regex(timeStringRegex, "Invalid end time format"),
  timezone: z.string().trim().min(2).max(80).optional().default("Africa/Lagos"),
  geofenceOverride: geofenceOverrideSchema,
  enabled: z.boolean().optional().default(true),
});

const updateRecurringEventSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    interval: z.number().int().min(1).max(30).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    startTime: z
      .string()
      .regex(timeStringRegex, "Invalid start time format")
      .optional(),
    endTime: z.string().regex(timeStringRegex, "Invalid end time format").optional(),
    timezone: z.string().trim().min(2).max(80).optional(),
    geofenceOverride: geofenceOverrideSchema,
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const recurringEventParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
  eventId: objectIdSchema,
});

const recurringEventAttendanceQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
});

module.exports = {
  createRecurringEventSchema,
  updateRecurringEventSchema,
  recurringEventParamsSchema,
  recurringEventAttendanceQuerySchema,
};
