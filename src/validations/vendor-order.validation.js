const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectId = (label) =>
  z.string().trim().regex(objectIdRegex, `Invalid ${label}`);

const eventVendorParamsSchema = z.object({
  eventId: objectId("event ID"),
  vendorId: objectId("vendor ID"),
});

const orderIdParamsSchema = z.object({
  orderId: objectId("order ID"),
});

const bookingIdParamsSchema = z.object({
  bookingId: objectId("booking ID"),
});

const placeOrderBodySchema = z.object({
  items: z
    .array(
      z.object({
        itemId: objectId("item ID"),
        quantity: z.coerce.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(40),
  note: z.string().trim().max(200).optional(),
  callbackUrl: z.string().trim().max(500).optional(),
});

const verifyOrderBodySchema = z.object({
  reference: z.string().trim().max(200).optional(),
});

const cancelOrderBodySchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/* Forward only: collection has its own route because it needs the code. */
const advanceOrderBodySchema = z.object({
  status: z.enum(["preparing", "ready"]),
});

const collectOrderBodySchema = z.object({
  code: z.string().trim().length(4),
});

const rateOrderBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});

const serviceStateBodySchema = z
  .object({
    acceptingOrders: z.coerce.boolean().optional(),
    prepMinutes: z.coerce.number().int().min(0).max(600).nullable().optional(),
    /* Tonight's counts, replacing whatever was there. */
    itemStock: z
      .array(
        z.object({
          itemId: objectId("item ID"),
          remaining: z.coerce.number().int().min(0).max(1_000_000),
        }),
      )
      .max(200)
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

const listMyOrdersQuerySchema = z.object({
  eventId: objectId("event ID").optional(),
  live: z.coerce.boolean().optional(),
});

const listVendorOrdersQuerySchema = z.object({
  eventId: objectId("event ID").optional(),
  status: z
    .enum(["paid", "preparing", "ready", "collected", "refunded", "cancelled"])
    .optional(),
});

module.exports = {
  advanceOrderBodySchema,
  bookingIdParamsSchema,
  cancelOrderBodySchema,
  collectOrderBodySchema,
  eventVendorParamsSchema,
  listMyOrdersQuerySchema,
  listVendorOrdersQuerySchema,
  orderIdParamsSchema,
  placeOrderBodySchema,
  rateOrderBodySchema,
  serviceStateBodySchema,
  verifyOrderBodySchema,
};
