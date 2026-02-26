const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectIdSchema = z.string().trim().regex(objectIdRegex, "Invalid id format");

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(20),
  search: z.string().trim().max(120).optional(),
});

const startDirectConversationSchema = z.object({
  recipientUserId: objectIdSchema,
});

const conversationIdParamsSchema = z.object({
  conversationId: objectIdSchema,
});

const sendDirectMessageSchema = z.object({
  message: z.string().trim().min(1).max(1200),
});

module.exports = {
  paginationQuerySchema,
  startDirectConversationSchema,
  conversationIdParamsSchema,
  sendDirectMessageSchema,
};
