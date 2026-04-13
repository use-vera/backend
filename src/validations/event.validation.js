const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const colorHexRegex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

const resalePolicySchema = z.object({
  enabled: z.boolean().optional().default(true),
  allowBids: z.boolean().optional().default(true),
  maxMarkupPercent: z.coerce.number().min(0).max(100).optional().default(25),
  bidWindowHours: z.coerce.number().int().min(1).max(72).optional().default(12),
});

const ticketSalesSchema = z.object({
  startsAt: dateStringSchema.nullish(),
  presaleEnabled: z.boolean().optional().default(false),
  presaleStartsAt: dateStringSchema.nullish(),
  presaleEndsAt: dateStringSchema.nullish(),
  presaleQuantity: z.coerce.number().int().min(1).max(200000).optional(),
  presalePriceNaira: z.coerce.number().min(0).optional(),
});

const ticketCategorySchema = z.object({
  categoryId: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(180).optional(),
  quantity: z.coerce.number().int().min(1).max(200000),
  priceNaira: z.coerce.number().min(0).optional().default(0),
});

const eventBrandingSchema = z.object({
  useOrganizerDefault: z.boolean().optional().default(true),
  overrideEnabled: z.boolean().optional().default(false),
  displayName: z.string().trim().max(120).optional(),
  tagline: z.string().trim().max(180).optional(),
  logoUrl: z.string().trim().url().max(500).optional(),
  bannerUrl: z.string().trim().url().max(500).optional(),
  primaryColor: z.string().trim().regex(colorHexRegex).optional(),
  accentColor: z.string().trim().regex(colorHexRegex).optional(),
  headerStyle: z.enum(["soft", "bold"]).optional().default("soft"),
  ticketStyle: z.enum(["classic", "branded"]).optional().default("classic"),
});

const createEventSchema = z
  .object({
    workspaceId: workspaceRefSchema.optional(),
    eventCenterId: objectIdSchema.optional(),
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
    platformFeePercent: z.coerce.number().min(0).max(100).optional().default(5),
    feeMode: z
      .enum(["absorbed_by_organizer", "passed_to_attendee"])
      .optional()
      .default("absorbed_by_organizer"),
    ticketPriceNaira: z.coerce.number().min(0).optional().default(0),
    expectedTickets: z.coerce.number().int().min(1).max(200000),
    ticketCategories: z.array(ticketCategorySchema).max(12).optional().default([]),
    branding: eventBrandingSchema.optional(),
    recurrence: recurrenceSchema.optional().default({ type: "none", interval: 1, daysOfWeek: [] }),
    pricing: pricingSchema.optional().default({
      dynamicEnabled: false,
      minPriceNaira: 0,
      maxPriceNaira: null,
      demandSensitivity: 1,
      discountFloorRatio: 0.8,
      surgeCapRatio: 1.6,
    }),
    resale: resalePolicySchema.optional().default({
      enabled: true,
      allowBids: true,
      maxMarkupPercent: 25,
      bidWindowHours: 12,
    }),
    sales: ticketSalesSchema.optional().default({
      startsAt: null,
      presaleEnabled: false,
      presaleStartsAt: null,
      presaleEndsAt: null,
      presaleQuantity: undefined,
      presalePriceNaira: undefined,
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
      const categories = Array.isArray(value.ticketCategories)
        ? value.ticketCategories
        : [];
      const hasValidCategoryPrice = categories.some(
        (item) => Number(item.priceNaira || 0) > 0,
      );

      if (!hasValidCategoryPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ticketPriceNaira"],
          message: "Paid events require ticketPriceNaira greater than 0",
        });
      }
    }

    if (!value.isPaid && value.ticketPriceNaira !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticketPriceNaira"],
        message: "Free events must set ticketPriceNaira to 0",
      });
    }

    if (Array.isArray(value.ticketCategories) && value.ticketCategories.length > 0) {
      const totalQuantity = value.ticketCategories.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0,
      );

      if (totalQuantity <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ticketCategories"],
          message: "Ticket categories must include at least one available seat",
        });
      }
    }

    const sales = value.sales || {};
    const salesStartAt = sales.startsAt ? new Date(sales.startsAt) : null;
    const presaleStartsAt = sales.presaleStartsAt
      ? new Date(sales.presaleStartsAt)
      : null;
    const presaleEndsAt = sales.presaleEndsAt
      ? new Date(sales.presaleEndsAt)
      : null;
    const presaleEnabled = Boolean(sales.presaleEnabled);

    if (salesStartAt && salesStartAt >= endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "startsAt"],
        message: "sales.startsAt must be before event endsAt",
      });
    }

    if (!presaleEnabled) {
      return;
    }

    if (!value.isPaid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleEnabled"],
        message: "Presale is only available for paid events",
      });
    }

    if (Array.isArray(value.ticketCategories) && value.ticketCategories.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleEnabled"],
        message: "Presale currently requires base pricing (no ticket categories)",
      });
    }

    if (!presaleStartsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleStartsAt"],
        message: "presaleStartsAt is required when presale is enabled",
      });
    }

    if (!presaleEndsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleEndsAt"],
        message: "presaleEndsAt is required when presale is enabled",
      });
    }

    if (!sales.presaleQuantity || Number(sales.presaleQuantity) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleQuantity"],
        message: "presaleQuantity is required when presale is enabled",
      });
    }

    if (!sales.presalePriceNaira || Number(sales.presalePriceNaira) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presalePriceNaira"],
        message: "presalePriceNaira must be greater than 0",
      });
    }

    const hasTicketCategories =
      Array.isArray(value.ticketCategories) && value.ticketCategories.length > 0;
    const basePrice = Number(value.ticketPriceNaira || 0);
    const presalePrice = Number(sales.presalePriceNaira || 0);

    if (value.isPaid && !hasTicketCategories && basePrice > 0 && presalePrice > 0) {
      if (presalePrice <= basePrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sales", "presalePriceNaira"],
          message: "presalePriceNaira must be greater than ticketPriceNaira",
        });
      }

      if (presalePrice > basePrice * 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sales", "presalePriceNaira"],
          message: "presalePriceNaira cannot exceed 2x ticketPriceNaira",
        });
      }
    }

    if (presaleStartsAt && presaleEndsAt && presaleEndsAt <= presaleStartsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleEndsAt"],
        message: "presaleEndsAt must be later than presaleStartsAt",
      });
    }

    if (salesStartAt && presaleEndsAt && presaleEndsAt > salesStartAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sales", "presaleEndsAt"],
        message: "presaleEndsAt must be on or before sales.startsAt",
      });
    }
  });

const updateEventSchema = z
  .object({
    eventCenterId: objectIdSchema.optional(),
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
    platformFeePercent: z.coerce.number().min(0).max(100).optional(),
    feeMode: z
      .enum(["absorbed_by_organizer", "passed_to_attendee"])
      .optional(),
    ticketPriceNaira: z.coerce.number().min(0).optional(),
    expectedTickets: z.coerce.number().int().min(1).max(200000).optional(),
    ticketCategories: z.array(ticketCategorySchema).max(12).optional(),
    branding: eventBrandingSchema.optional(),
    recurrence: recurrenceSchema.optional(),
    pricing: pricingSchema.optional(),
    resale: resalePolicySchema.optional(),
    sales: ticketSalesSchema.optional(),
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
  salePhase: z.enum(["all", "main", "presale"]).optional().default("main"),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  ticketType: z.enum(["all", "free", "paid"]).optional().default("all"),
  workspaceId: workspaceRefSchema.optional(),
});

const listFeaturedEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
  workspaceId: workspaceRefSchema.optional(),
  salePhase: z.enum(["all", "main", "presale"]).optional().default("main"),
});

const searchEventCentersQuerySchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
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

const organizerIdParamsSchema = z.object({
  organizerId: objectIdSchema,
});

const ticketIdParamsSchema = z.object({
  ticketId: objectIdSchema,
});

const postIdParamsSchema = z.object({
  postId: objectIdSchema,
});

const ticketBidParamsSchema = z.object({
  ticketId: objectIdSchema,
  bidId: objectIdSchema,
});

const ticketTodoParamsSchema = z.object({
  ticketId: objectIdSchema,
  todoId: objectIdSchema,
});

const initializeTicketPurchaseSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(10).optional().default(1),
  ticketCategoryId: z.string().trim().min(1).max(60).optional(),
  email: z.string().email().trim().max(160).optional(),
  attendeeName: z.string().trim().max(140).optional(),
  callbackUrl: z.string().trim().url().max(400).optional(),
});

const initializeResalePurchaseSchema = z.object({
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

const eventChatMessageBodySchema = z
  .object({
    message: z.string().trim().max(1200).optional(),
    messageType: z.enum(["text", "ticket", "event"]).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    replyToMessageId: objectIdSchema.optional(),
    forwardedFromMessageId: objectIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasMessage = Boolean(String(value.message || "").trim());
    const type = String(value.messageType || "text");

    if (!hasMessage && type === "text") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "message is required for text chat",
      });
    }
  });

const eventChatMessageParamsSchema = z.object({
  eventId: objectIdSchema,
  messageId: objectIdSchema,
});

const updateEventChatMessageBodySchema = z.object({
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

const createTicketResaleSchema = z.object({
  priceNaira: z.coerce.number().int().min(1).max(100000000),
  quantity: z.coerce.number().int().min(1).max(20).optional(),
  allowBids: z.boolean().optional(),
});

const listTicketResaleBidsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const createTicketResaleBidSchema = z.object({
  amountNaira: z.coerce.number().int().min(1).max(100000000),
});

const listEventResaleMarketplaceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const createTicketTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    notes: z.string().trim().max(800).optional().default(""),
    dueAt: dateStringSchema,
    remindAt: dateStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const dueAt = new Date(value.dueAt);
    const remindAt = value.remindAt ? new Date(value.remindAt) : null;

    if (remindAt && remindAt > dueAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remindAt"],
        message: "remindAt cannot be after dueAt",
      });
    }
  });

const updateTicketTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    notes: z.string().trim().max(800).optional(),
    dueAt: dateStringSchema.optional(),
    remindAt: dateStringSchema.nullish(),
    isCompleted: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
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
  searchEventCentersQuerySchema,
  listMyEventsQuerySchema,
  eventIdParamsSchema,
  organizerIdParamsSchema,
  ticketIdParamsSchema,
  postIdParamsSchema,
  ticketBidParamsSchema,
  ticketTodoParamsSchema,
  ticketCategorySchema,
  initializeTicketPurchaseSchema,
  initializeResalePurchaseSchema,
  verifyTicketPaymentSchema,
  ticketCheckInSchema,
  listMyTicketsQuerySchema,
  listOrganizerTicketSalesQuerySchema,
  listEventRatingsQuerySchema,
  rateEventSchema,
  listEventFeedQuerySchema,
  eventReminderSchema,
  eventChatMessageBodySchema,
  eventChatMessageParamsSchema,
  updateEventChatMessageBodySchema,
  eventChatQuerySchema,
  createEventPostSchema,
  listEventPostsQuerySchema,
  createEventPostCommentSchema,
  listEventPostCommentsQuerySchema,
  createTicketResaleSchema,
  listTicketResaleBidsQuerySchema,
  createTicketResaleBidSchema,
  listEventResaleMarketplaceQuerySchema,
  createTicketTodoSchema,
  updateTicketTodoSchema,
};
