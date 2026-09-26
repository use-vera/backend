const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectId = (label) =>
  z.string().trim().regex(objectIdRegex, `Invalid ${label}`);

const termsSchema = z.object({
  stallFeeNaira: z.coerce.number().int().min(0).max(100_000_000).optional(),
  stallLabel: z.string().trim().max(80).optional(),
  setupFrom: z.coerce.date().nullable().optional(),
});

const vendorSettingsBodySchema = z
  .object({
    acceptingApplications: z.coerce.boolean().optional(),
    stallFeeNaira: z.coerce.number().int().min(0).max(100_000_000).optional(),
    spots: z.coerce.number().int().min(0).max(500).optional(),
    setupFrom: z.coerce.date().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

const inviteVendorBodySchema = z.object({
  vendorId: objectId("vendor ID"),
  message: z.string().trim().max(400).optional(),
  terms: termsSchema.optional(),
});

const decideApplicationBodySchema = z.object({
  accept: z.coerce.boolean(),
  terms: termsSchema.optional(),
});

const respondToInviteBodySchema = z.object({
  accept: z.coerce.boolean(),
  note: z.string().trim().max(400).optional(),
  callbackUrl: z.string().trim().max(500).optional(),
});

const verifyStallFeeBodySchema = z.object({
  reference: z.string().trim().max(200).optional(),
});

const applyToEventBodySchema = z.object({
  eventId: objectId("event ID"),
  message: z.string().trim().max(400).optional(),
});

const bookingIdParamsSchema = z.object({
  eventId: objectId("event ID"),
  bookingId: objectId("booking ID"),
});

const vendorBookingIdParamsSchema = z.object({
  bookingId: objectId("booking ID"),
});

const eventIdParamsSchema = z.object({
  eventId: objectId("event ID"),
});

const listBookingsQuerySchema = z.object({
  status: z
    .enum(["invited", "applied", "confirmed", "declined", "rejected", "cancelled"])
    .optional(),
});

const listOpenEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

module.exports = {
  applyToEventBodySchema,
  bookingIdParamsSchema,
  decideApplicationBodySchema,
  eventIdParamsSchema,
  inviteVendorBodySchema,
  listBookingsQuerySchema,
  listOpenEventsQuerySchema,
  respondToInviteBodySchema,
  vendorBookingIdParamsSchema,
  vendorSettingsBodySchema,
  verifyStallFeeBodySchema,
};
