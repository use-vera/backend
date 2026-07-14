const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const eventParamsSchema = z.object({
  eventId: objectIdSchema,
});

const orderParamsSchema = z.object({
  ticketId: objectIdSchema,
});

const checkoutSessionParamsSchema = z.object({
  sessionId: objectIdSchema,
});

const createCheckoutSessionSchema = z.object({
  eventId: objectIdSchema,
  quantity: z.coerce.number().int().min(1).max(10).default(1),
  ticketCategoryId: objectIdSchema.optional(),
  customerEmail: z.string().trim().email(),
  customerName: z.string().trim().max(120).optional(),
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const verifyTicketSchema = z.object({
  code: z.string().trim().min(1),
  eventId: objectIdSchema.optional(),
});

const checkInTicketSchema = z.object({
  code: z.string().trim().min(1),
  eventId: objectIdSchema.optional(),
  override: z.boolean().optional().default(false),
});

const createRefundSchema = z.object({
  ticketId: objectIdSchema,
  reason: z.string().trim().max(300).optional(),
});

module.exports = {
  paginationQuerySchema,
  eventParamsSchema,
  orderParamsSchema,
  checkoutSessionParamsSchema,
  createCheckoutSessionSchema,
  verifyTicketSchema,
  checkInTicketSchema,
  createRefundSchema,
};
