const { z } = require("zod");

const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const dateQuerySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });

const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    avatarUrl: z.string().trim().url().optional(),
    phoneNumber: z.string().trim().max(32).optional(),
    title: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(280).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

const updatePreferencesSchema = z
  .object({
    trackOnlyActiveHours: z.boolean().optional(),
    activeHoursStart: z.coerce.number().int().min(0).max(23).optional(),
    activeHoursEnd: z.coerce.number().int().min(0).max(23).optional(),
    quietCheckIn: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
    themePreference: z.enum(["system", "light", "dark"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preferences field is required",
  })
  .refine(
    (value) =>
      value.activeHoursStart === undefined ||
      value.activeHoursEnd === undefined ||
      value.activeHoursStart !== value.activeHoursEnd,
    {
      message: "activeHoursStart and activeHoursEnd cannot be the same",
      path: ["activeHoursEnd"],
    },
  );

const attendanceReportQuerySchema = z
  .object({
    workspaceId: z.string().trim().regex(workspaceRefRegex).optional(),
    period: z.enum(["weekly", "monthly", "custom"]).optional().default("weekly"),
    from: dateQuerySchema.optional(),
    to: dateQuerySchema.optional(),
  })
  .refine(
    (value) =>
      value.period !== "custom" ||
      (value.from !== undefined && value.to !== undefined),
    {
      message: "'from' and 'to' are required when period is custom",
      path: ["period"],
    },
  );

module.exports = {
  updateProfileSchema,
  updatePasswordSchema,
  updatePreferencesSchema,
  attendanceReportQuerySchema,
};
