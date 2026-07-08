const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const listWalletTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  type: z
    .enum([
      "all",
      "ticket_sale",
      "platform_fee",
      "refund",
      "chargeback",
      "settlement",
      "withdrawal",
      "withdrawal_reversal",
      "adjustment",
    ])
    .optional()
    .default("all"),
});

const upsertPayoutAccountSchema = z.object({
  bankCode: z.string().trim().min(1).max(20),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits"),
});

const requestWithdrawalSchema = z.object({
  amountKobo: z.coerce.number().int().min(1),
});

const listWithdrawalsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const applyChargebackSchema = z.object({
  ticketId: z.string().trim().regex(objectIdRegex, "Invalid ticket id"),
  amountKobo: z.coerce.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});

const refundTicketSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

module.exports = {
  objectIdRegex,
  listWalletTransactionsQuerySchema,
  upsertPayoutAccountSchema,
  requestWithdrawalSchema,
  listWithdrawalsQuerySchema,
  applyChargebackSchema,
  refundTicketSchema,
};
