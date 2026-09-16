const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const userIdParamsSchema = z.object({
  userId: z.string().trim().regex(objectIdRegex, "Invalid user ID"),
});

const listConnectionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(120).optional(),
});

module.exports = {
  userIdParamsSchema,
  listConnectionsQuerySchema,
};
