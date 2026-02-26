const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
const workspaceRefSchema = z
  .string()
  .trim()
  .regex(workspaceRefRegex, "Invalid workspace reference");

const dateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });

const recurrenceSchema = z
  .object({
    type: z
      .enum(["none", "weekly", "monthly-day", "monthly-weekday"])
      .default("none"),
    interval: z.coerce.number().int().min(1).max(12).optional().default(1),
    daysOfWeek: z
      .array(z.coerce.number().int().min(0).max(6))
      .optional()
      .default([]),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
    weekOfMonth: z.coerce.number().int().refine((value) => [1, 2, 3, 4, -1].includes(value), {
      message: "weekOfMonth must be 1,2,3,4 or -1",
    }).optional(),
    weekday: z.coerce.number().int().min(0).max(6).optional(),
    endsOn: dateStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "weekly" && (!value.daysOfWeek || value.daysOfWeek.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daysOfWeek"],
        message: "Weekly recurrence requires daysOfWeek",
      });
    }

    if (value.type === "monthly-day" && !value.dayOfMonth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfMonth"],
        message: "Monthly-by-day recurrence requires dayOfMonth",
      });
    }

    if (value.type === "monthly-weekday") {
      if (value.weekOfMonth === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekOfMonth"],
          message: "Monthly-by-weekday recurrence requires weekOfMonth",
        });
      }

      if (value.weekday === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekday"],
          message: "Monthly-by-weekday recurrence requires weekday",
        });
      }
    }
  });

const pricingSchema = z
  .object({
    dynamicEnabled: z.boolean().optional().default(false),
    minPriceNaira: z.coerce.number().min(0).optional().default(0),
    maxPriceNaira: z.coerce.number().min(0).nullable().optional().default(null),
    demandSensitivity: z.coerce.number().min(0.1).max(3).optional().default(1),
    discountFloorRatio: z.coerce.number().min(0.4).max(1).optional().default(0.8),
    surgeCapRatio: z.coerce.number().min(1).max(3).optional().default(1.6),
  })
  .superRefine((value, ctx) => {
    if (
      value.maxPriceNaira !== null &&
      value.maxPriceNaira !== undefined &&
      value.maxPriceNaira < value.minPriceNaira
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPriceNaira"],
        message: "maxPriceNaira cannot be less than minPriceNaira",
      });
    }
  });

const createEventSchema = z
  .object({
    workspaceId: workspaceRefSchema.optional(),
    name: z.string().trim().min(2).max(140),
    description: z.string().trim().max(1200).optional(),
    imageUrl: z.string().trim().max(600).optional(),
    address: z.string().trim().min(2).max(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    geofenceRadiusMeters: z
      .coerce
      .number()
      .int()
      .min(20)
      .max(10000)
      .optional()
      .default(150),
    startsAt: dateStringSchema,
    endsAt: dateStringSchema,
    timezone: z.string().trim().min(2).max(80).optional().default("Africa/Lagos"),
    isPaid: z.boolean().optional().default(false),
    ticketPriceNaira: z.coerce.number().min(0).optional().default(0),
    expectedTickets: z.coerce.number().int().min(1).max(200000),
    recurrence: recurrenceSchema.optional().default({ type: "none", interval: 1, daysOfWeek: [] }),
    pricing: pricingSchema.optional().default({
      dynamicEnabled: false,
      minPriceNaira: 0,
      maxPriceNaira: null,
      demandSensitivity: 1,
      discountFloorRatio: 0.8,
      surgeCapRatio: 1.6,
    }),
    status: z.enum(["draft", "published", "cancelled"]).optional().default("published"),
  })
  .superRefine((value, ctx) => {
    const startsAt = new Date(value.startsAt);
    const endsAt = new Date(value.endsAt);

    if (startsAt >= endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "endsAt must be later than startsAt",
      });
    }

    if (value.isPaid && value.ticketPriceNaira <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticketPriceNaira"],
        message: "Paid events require ticketPriceNaira greater than 0",
      });
    }

    if (!value.isPaid && value.ticketPriceNaira !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticketPriceNaira"],
        message: "Free events must set ticketPriceNaira to 0",
      });
    }
  });

const updateEventSchema = z
  .object({
    name: z.string().trim().min(2).max(140).optional(),
    description: z.string().trim().max(1200).optional(),
    imageUrl: z.string().trim().max(600).optional(),
    address: z.string().trim().min(2).max(300).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    geofenceRadiusMeters: z.coerce.number().int().min(20).max(10000).optional(),
    startsAt: dateStringSchema.optional(),
    endsAt: dateStringSchema.optional(),
    timezone: z.string().trim().min(2).max(80).optional(),
    isPaid: z.boolean().optional(),
    ticketPriceNaira: z.coerce.number().min(0).optional(),
    expectedTickets: z.coerce.number().int().min(1).max(200000).optional(),
    recurrence: recurrenceSchema.optional(),
    pricing: pricingSchema.optional(),
    status: z.enum(["draft", "published", "cancelled"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["dateAsc", "dateDesc", "newest"]).optional().default("dateAsc"),
  filter: z.enum(["upcoming", "this-month", "all"]).optional().default("upcoming"),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  ticketType: z.enum(["all", "free", "paid"]).optional().default("all"),
  workspaceId: workspaceRefSchema.optional(),
});

const listFeaturedEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
  workspaceId: workspaceRefSchema.optional(),
});

const listMyEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["all", "draft", "published", "cancelled"]).optional().default("all"),
});

const eventIdParamsSchema = z.object({
  eventId: objectIdSchema,
});

const ticketIdParamsSchema = z.object({
  ticketId: objectIdSchema,
});

const postIdParamsSchema = z.object({
  postId: objectIdSchema,
});

const initializeTicketPurchaseSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(10).optional().default(1),
  email: z.string().email().trim().max(160).optional(),
  attendeeName: z.string().trim().max(140).optional(),
  callbackUrl: z.string().trim().url().max(400).optional(),
});

const verifyTicketPaymentSchema = z.object({
  reference: z.string().trim().min(6).max(180).optional(),
});

const ticketCheckInSchema = z.object({
  code: z.string().trim().min(3).max(600),
  eventId: objectIdSchema.optional(),
});

const listMyTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(120).optional(),
  status: z
    .enum(["all", "pending", "paid", "used", "cancelled", "expired"])
    .optional()
    .default("all"),
});

const listOrganizerTicketSalesQuerySchema = listMyTicketsQuerySchema;

const listEventRatingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const listEventFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  scope: z.enum(["global", "mine"]).optional().default("global"),
  search: z.string().trim().max(120).optional(),
});

const eventReminderSchema = z.object({
  enabled: z.boolean().optional(),
  offsetsMinutes: z
    .array(z.coerce.number().int().min(5).max(20160))
    .max(6)
    .optional(),
});

const eventChatMessageBodySchema = z.object({
  message: z.string().trim().min(1).max(1200),
});

const eventChatQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(25),
});

const createEventPostSchema = z.object({
  type: z.enum(["photo", "update"]).optional().default("photo"),
  caption: z.string().trim().max(800).optional().default(""),
  imageUrl: z.string().trim().max(600).optional().default(""),
  visibility: z.enum(["public", "ticket-holders"]).optional().default("public"),
});

const listEventPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const createEventPostCommentSchema = z.object({
  comment: z.string().trim().min(1).max(800),
});

const listEventPostCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(80).optional().default(25),
});

const rateEventSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().trim().max(600).optional().default(""),
});

module.exports = {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  listFeaturedEventsQuerySchema,
  listMyEventsQuerySchema,
  eventIdParamsSchema,
  ticketIdParamsSchema,
  postIdParamsSchema,
  initializeTicketPurchaseSchema,
  verifyTicketPaymentSchema,
  ticketCheckInSchema,
  listMyTicketsQuerySchema,
  listOrganizerTicketSalesQuerySchema,
  listEventRatingsQuerySchema,
  rateEventSchema,
  listEventFeedQuerySchema,
  eventReminderSchema,
  eventChatMessageBodySchema,
  eventChatQuerySchema,
  createEventPostSchema,
  listEventPostsQuerySchema,
  createEventPostCommentSchema,
  listEventPostCommentsQuerySchema,
};
