const { z } = require("zod");

const seesSchema = z
  .object({
    location: z.boolean().optional(),
    weather: z.boolean().optional(),
    ratings: z.boolean().optional(),
    following: z.boolean().optional(),
    calendar: z.boolean().optional(),
    budget: z.boolean().optional(),
    usualSpend: z.boolean().optional(),
  })
  .strict();

const updateVeraSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    sees: seesSchema.optional(),
    /* null clears the budget. */
    weeklyBudgetNaira: z.number().int().min(0).max(10000000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

const sendVeraMessageSchema = z
  .object({
    text: z.string().trim().min(1, "Ask Vera something").max(500),
    /* Approximate, and only sent when the person lets Vera use where they are. */
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict()
      .optional(),
  })
  .strict();

const listVeraMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
});

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

/* A primary hold (event + optional tier + quantity) or a resale hold (one listing). */
const createHoldSchema = z.union([
  z
    .object({
      eventId: objectId,
      ticketCategoryId: objectId.optional(),
      quantity: z.number().int().min(1).max(4).optional().default(1),
    })
    .strict(),
  z.object({ resaleTicketId: objectId }).strict(),
]);

const createWatchSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resale_price"),
      eventId: objectId,
      maxPriceNaira: z.number().int().min(1).max(10000000),
      action: z.enum(["notify", "hold"]).optional().default("notify"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("host_drop"),
      eventId: objectId,
      action: z.enum(["notify", "hold"]).optional().default("notify"),
    })
    .strict(),
]);

const updateWatchSchema = z
  .object({
    action: z.enum(["notify", "hold"]).optional(),
    /* "watching" re-arms a watch that already went off. */
    status: z.literal("watching").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

const idParamsSchema = z.object({ id: objectId });

module.exports = {
  updateVeraSettingsSchema,
  sendVeraMessageSchema,
  listVeraMessagesQuerySchema,
  createHoldSchema,
  createWatchSchema,
  updateWatchSchema,
  idParamsSchema,
};
