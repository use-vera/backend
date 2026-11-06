const { z } = require("zod");

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const startGroupSchema = z.object({ eventId: objectId }).strict();
const listGroupsQuerySchema = z.object({ eventId: objectId.optional() });
const groupParamsSchema = z.object({ groupId: objectId });
const memberParamsSchema = z.object({ groupId: objectId, userId: objectId });
const shareParamsSchema = z.object({ shareId: objectId });

const inviteSchema = z.object({ userIds: z.array(objectId).min(1).max(11) }).strict();
const respondSchema = z.object({ accept: z.boolean() }).strict();
const sendTicketSchema = z
  .object({
    ticketId: objectId,
    toUserId: objectId,
    /* The owner covers it: they won't owe anything. */
    onMe: z.boolean().optional().default(false),
  })
  .strict();
const startPaymentSchema = z.object({ callbackUrl: z.string().trim().max(500).optional() }).strict();
const verifyPaymentSchema = z.object({ reference: z.string().trim().min(1).max(200) }).strict();

module.exports = {
  startGroupSchema,
  listGroupsQuerySchema,
  groupParamsSchema,
  memberParamsSchema,
  shareParamsSchema,
  inviteSchema,
  respondSchema,
  sendTicketSchema,
  startPaymentSchema,
  verifyPaymentSchema,
};
