const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });
const colorHexRegex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const eventCampaignParamsSchema = z.object({
  eventId: objectIdSchema,
  campaignId: objectIdSchema,
});

const eventExportParamsSchema = z.object({
  eventId: objectIdSchema,
  exportId: objectIdSchema,
});

const listEventCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(120).optional(),
  channel: z.enum(["all", "email", "sms"]).optional(),
  status: z
    .enum(["all", "draft", "scheduled", "sending", "sent", "failed", "cancelled"])
    .optional(),
});

const createEventCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["email", "sms"]).optional().default("email"),
  audience: z
    .enum([
      "all_ticket_holders",
      "checked_in_attendees",
      "paid_not_checked_in",
      "presale_buyers",
      "ticket_category",
    ])
    .optional()
    .default("all_ticket_holders"),
  audienceTicketCategoryId: objectIdSchema.optional(),
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(3).max(4000),
  action: z.enum(["draft", "send_now", "schedule"]).optional().default("draft"),
  scheduledAt: isoDateSchema.optional(),
});

const updateEventCampaignScheduleSchema = z.object({
  action: z.enum(["send_now", "schedule", "cancel"]),
  scheduledAt: isoDateSchema.optional(),
});

const updateEventBrandingSchema = z
  .object({
    useOrganizerDefault: z.boolean().optional(),
    overrideEnabled: z.boolean().optional(),
    displayName: z.string().trim().min(2).max(120).optional(),
    tagline: z.string().trim().max(180).optional(),
    logoUrl: z.string().trim().url().max(500).optional(),
    bannerUrl: z.string().trim().url().max(500).optional(),
    primaryColor: z.string().trim().regex(colorHexRegex).optional(),
    accentColor: z.string().trim().regex(colorHexRegex).optional(),
    headerStyle: z.enum(["soft", "bold"]).optional(),
    ticketStyle: z.enum(["classic", "branded"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one branding field is required",
  });

const listEventExportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createEventExportSchema = z
  .object({
    kind: z.enum(["tickets", "attendees", "finance", "campaigns"]),
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
  eventCampaignParamsSchema,
  eventExportParamsSchema,
  listEventCampaignsQuerySchema,
  createEventCampaignSchema,
  updateEventCampaignScheduleSchema,
  updateEventBrandingSchema,
  listEventExportsQuerySchema,
  createEventExportSchema,
};
