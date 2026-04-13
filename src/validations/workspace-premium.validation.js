const { z } = require("zod");

const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });

const colorHexRegex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const updateWorkspaceBrandingSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    tagline: z.string().trim().max(180).optional(),
    logoUrl: z.string().trim().url().max(500).optional(),
    bannerUrl: z.string().trim().url().max(500).optional(),
    primaryColor: z.string().trim().regex(colorHexRegex).optional(),
    accentColor: z.string().trim().regex(colorHexRegex).optional(),
    websiteUrl: z.string().trim().url().max(500).optional(),
    supportEmail: z.string().trim().email().max(160).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one branding field is required",
  });

const listWorkspaceCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(120).optional(),
  channel: z.enum(["all", "in_app", "email", "sms"]).optional(),
  audience: z.enum(["all", "members", "attendees"]).optional(),
});

const sendWorkspaceCampaignSchema = z.object({
  subject: z.string().trim().min(2).max(160).optional(),
  message: z.string().trim().min(3).max(2000),
  channel: z.enum(["in_app", "email", "sms"]).optional().default("in_app"),
  audience: z
    .enum(["members", "attendees", "all"])
    .optional()
    .default("all"),
});

const createWorkspaceExportSchema = z
  .object({
    kind: z.enum(["ticket_sales", "attendance_logs", "campaigns"]),
    format: z.enum(["csv", "json"]).optional().default("csv"),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(
    (value) =>
      (value.from === undefined && value.to === undefined) ||
      (value.from !== undefined && value.to !== undefined),
    {
      message: "Provide both from and to dates together",
      path: ["from"],
    },
  );

module.exports = {
  updateWorkspaceBrandingSchema,
  listWorkspaceCampaignsQuerySchema,
  sendWorkspaceCampaignSchema,
  createWorkspaceExportSchema,
};
