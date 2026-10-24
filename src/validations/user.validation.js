const { z } = require("zod");
const { TOPIC_KEYS } = require("../constants/notification-topics");

const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
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
    /* Shape and availability are checked in the service, which owns the
       rules; this only bounds the input. */
    handle: z.string().trim().min(1).max(32).optional(),
    avatarUrl: z.string().trim().url().optional(),
    phoneNumber: z.string().trim().max(32).optional(),
    title: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(280).optional(),
    state: z.string().trim().max(80).optional(),
    /* A real date in the past, and a plausible one: a typo that makes
       somebody 200 years old should not pass as an adult. */
    dateOfBirth: z.coerce
      .date()
      .refine((value) => value.getTime() < Date.now(), {
        message: "Date of birth must be in the past",
      })
      .refine(
        (value) =>
          value.getTime() > Date.now() - 120 * 365.25 * 24 * 60 * 60 * 1000,
        { message: "Check that date of birth" },
      )
      .optional(),
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
    shareActivityWithFollowers: z.boolean().optional(),
    preferredCategoryIds: z.array(objectIdSchema).max(30).optional(),
    marketingOptIn: z.boolean().optional(),
    notifications: z
      .object(Object.fromEntries(TOPIC_KEYS.map((topic) => [topic, z.boolean().optional()])))
      .strict()
      .optional(),
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

const handleCheckQuerySchema = z.object({
  handle: z.string().trim().min(1).max(32),
});

const handleParamsSchema = z.object({
  handle: z.string().trim().min(1).max(32),
});

const userIdParamsSchema = z.object({
  userId: z.string().regex(objectIdRegex, "Invalid user id"),
});

const emailChangeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a real email address").max(254),
});

const emailChangeConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const deleteAccountSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const searchPeopleQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

const recapQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

const suggestedHostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).optional().default(12),
});

module.exports = {
  handleCheckQuerySchema,
  suggestedHostsQuerySchema,
  updateProfileSchema,
  updatePasswordSchema,
  updatePreferencesSchema,
  attendanceReportQuerySchema,
  handleParamsSchema,
  recapQuerySchema,
  userIdParamsSchema,
  emailChangeRequestSchema,
  emailChangeConfirmSchema,
  deleteAccountSchema,
  searchPeopleQuerySchema,
};
