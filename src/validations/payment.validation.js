const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const listPaymentAttemptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  status: z
    .enum(["all", "initialized", "success", "failed", "abandoned", "expired"])
    .optional(),
  kind: z.enum(["all", "ticket_purchase", "ticket_resale_purchase"]).optional(),
  scope: z.enum(["mine", "organizer"]).optional(),
  eventId: z
    .string()
    .trim()
    .regex(objectIdRegex, "Event ID must be a valid identifier")
    .optional(),
  search: z.string().trim().max(120).optional(),
});

const paymentAttemptParamsSchema = z.object({
  attemptId: z
    .string()
    .trim()
    .regex(objectIdRegex, "Payment attempt ID must be a valid identifier"),
});

module.exports = {
  listPaymentAttemptsQuerySchema,
  paymentAttemptParamsSchema,
};
