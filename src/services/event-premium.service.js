const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const EventTicket = require("../models/event-ticket.model");
const EventCampaign = require("../models/event-campaign.model");
const EventExport = require("../models/event-export.model");
const { createNotification } = require("./notification.service");
const { syncUserSubscriptionState } = require("./subscription.service");
const env = require("../config/env");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const campaignTickMs = Math.max(
  60 * 1000,
  Number(env.eventCampaignTickMs || 60 * 1000),
);

let campaignIntervalHandle = null;
let campaignTickRunning = false;

const DEFAULT_BRANDING = {
  displayName: "",
  tagline: "",
  logoUrl: "",
  bannerUrl: "",
  primaryColor: "#5BDFB3",
  accentColor: "#7C5CFF",
  headerStyle: "soft",
  ticketStyle: "classic",
};

const COLOR_HEX_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isDbConnected = () => mongoose.connection.readyState === 1;

const toIdString = (value) => String(value?._id || value || "").trim();

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

const normalizeColor = (value, fallback) => {
  const trimmed = String(value || "").trim();

  if (COLOR_HEX_REGEX.test(trimmed)) {
    return trimmed;
  }

  return fallback;
};

const normalizeBranding = (input = {}, fallback = {}) => ({
  displayName: String(input.displayName || fallback.displayName || "").trim(),
  tagline: String(input.tagline || fallback.tagline || "").trim(),
  logoUrl: String(input.logoUrl || fallback.logoUrl || "").trim(),
  bannerUrl: String(input.bannerUrl || fallback.bannerUrl || "").trim(),
  primaryColor: normalizeColor(
    input.primaryColor,
    fallback.primaryColor || DEFAULT_BRANDING.primaryColor,
  ),
  accentColor: normalizeColor(
    input.accentColor,
    fallback.accentColor || DEFAULT_BRANDING.accentColor,
  ),
  headerStyle:
    String(input.headerStyle || fallback.headerStyle || "soft").trim() === "bold"
      ? "bold"
      : "soft",
  ticketStyle:
    String(input.ticketStyle || fallback.ticketStyle || "classic").trim() ===
    "branded"
      ? "branded"
      : "classic",
});

const resolveBranding = ({ organizerBranding, eventBranding }) => {
  const organizer = normalizeBranding(organizerBranding || {}, DEFAULT_BRANDING);
  const override = normalizeBranding(eventBranding || {}, organizer);
  const useOrganizerDefault = Boolean(eventBranding?.useOrganizerDefault !== false);
  const overrideEnabled = Boolean(eventBranding?.overrideEnabled);

  if (!overrideEnabled) {
    return {
      ...organizer,
      source: "organizer_default",
    };
  }

  if (useOrganizerDefault) {
    return {
      ...organizer,
      ...override,
      source: "event_override",
    };
  }

  return {
    ...DEFAULT_BRANDING,
    ...override,
    source: "event_override",
  };
};

const requirePremiumAccess = async (actorUserId) => {
  const { subscription } = await syncUserSubscriptionState({
    userId: actorUserId,
  });

  if (
    subscription.subscriptionTier !== "premium" ||
    subscription.subscriptionStatus !== "active"
  ) {
    throw new ApiError(403, "This feature is available on Vera Premium only");
  }

  return subscription;
};

const requireEventCreator = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId).populate(
    "organizerUserId",
    "fullName email organizerBranding",
  );

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (toIdString(event.organizerUserId) !== toIdString(actorUserId)) {
    throw new ApiError(403, "Only the event creator can manage this feature");
  }

  return event;
};

const mapCampaignForResponse = (campaign) => {
  const event =
    campaign?.eventId && typeof campaign.eventId === "object"
      ? campaign.eventId
      : null;

  return {
    ...campaign.toJSON(),
    event:
      event && event._id
        ? {
            _id: String(event._id),
            name: event.name,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
          }
        : null,
  };
};

const listCampaignRecipients = async ({
  eventId,
  audience,
  audienceTicketCategoryId,
}) => {
  const baseQuery = {
    eventId,
    status: { $in: ["paid", "used"] },
  };

  if (audience === "checked_in_attendees") {
    baseQuery.status = "used";
  }

  if (audience === "paid_not_checked_in") {
    baseQuery.status = "paid";
  }

  if (audience === "presale_buyers") {
    baseQuery["paymentMetadata.salePhase"] = "presale";
  }

  if (audience === "ticket_category" && objectIdRegex.test(audienceTicketCategoryId)) {
    baseQuery.ticketCategoryId = new mongoose.Types.ObjectId(
      String(audienceTicketCategoryId),
    );
  }

  const rows = await EventTicket.find(baseQuery).select("buyerUserId").lean();
  const recipients = [...new Set(rows.map((row) => String(row.buyerUserId || "")).filter(Boolean))];

  return recipients;
};

const dispatchEventCampaignNow = async ({
  campaignId,
  actorUserId,
  skipPremiumValidation = false,
}) => {
  const campaign = await EventCampaign.findById(campaignId)
    .populate("eventId", "name organizerUserId")
    .populate("organizerUserId", "fullName email");

  if (!campaign) {
    throw new ApiError(404, "Campaign not found");
  }

  const event = campaign.eventId;

  if (!event || typeof event !== "object") {
    throw new ApiError(404, "Campaign event not found");
  }

  if (toIdString(event.organizerUserId) !== toIdString(actorUserId)) {
    throw new ApiError(403, "Only the event creator can send this campaign");
  }

  if (!skipPremiumValidation) {
    await requirePremiumAccess(actorUserId);
  }

  if (campaign.status === "sent") {
    return mapCampaignForResponse(campaign);
  }

  campaign.status = "sending";
  campaign.lastError = "";
  await campaign.save();

  const recipients = await listCampaignRecipients({
    eventId: event._id,
    audience: campaign.audience,
    audienceTicketCategoryId: campaign.audienceTicketCategoryId
      ? String(campaign.audienceTicketCategoryId)
      : "",
  });

  const title =
    String(campaign.subject || "").trim() || `${event.name} update`;
  let deliveredCount = 0;
  let failedCount = 0;

  if (recipients.length) {
    const deliveries = await Promise.allSettled(
      recipients.map((userId) =>
        createNotification({
          userId,
          type: "event_campaign",
          title,
          message: campaign.message,
          data: {
            target: "event-campaign",
            eventId: String(event._id),
            campaignId: String(campaign._id),
            channel: campaign.channel,
          },
          push: true,
        }),
      ),
    );

    deliveries.forEach((result) => {
      if (result.status === "fulfilled") {
        deliveredCount += 1;
      } else {
        failedCount += 1;
      }
    });
  }

  campaign.recipientsCount = recipients.length;
  campaign.deliveredCount = deliveredCount;
  campaign.failedCount = failedCount;
  campaign.sentAt = new Date();
  campaign.scheduledAt = null;
  campaign.status =
    deliveredCount === 0 && recipients.length > 0
      ? "failed"
      : "sent";
  campaign.metadata = {
    ...(campaign.metadata || {}),
    dispatchMode:
      campaign.channel === "email"
        ? "email_adapter_stub_with_in_app_push"
        : "sms_adapter_stub_with_in_app_push",
  };
  await campaign.save();

  return mapCampaignForResponse(campaign);
};

const listEventCampaigns = async ({
  eventId,
  actorUserId,
  query = {},
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const safePage = Math.max(1, Number(query.page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const filters = {
    eventId,
  };

  if (query.channel && query.channel !== "all") {
    filters.channel = query.channel;
  }

  if (query.status && query.status !== "all") {
    filters.status = query.status;
  }

  const search = String(query.search || "").trim();

  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filters.$or = [{ name: pattern }, { subject: pattern }, { message: pattern }];
  }

  const [items, totalItems] = await Promise.all([
    EventCampaign.find(filters)
      .populate("eventId", "name startsAt endsAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    EventCampaign.countDocuments(filters),
  ]);

  return {
    items: items.map(mapCampaignForResponse),
    ...buildPaginationMeta({
      page: safePage,
      limit: safeLimit,
      totalItems,
    }),
  };
};

const getEventCampaignById = async ({ eventId, campaignId, actorUserId }) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const campaign = await EventCampaign.findOne({
    _id: campaignId,
    eventId,
  }).populate("eventId", "name startsAt endsAt");

  if (!campaign) {
    throw new ApiError(404, "Campaign not found");
  }

  return mapCampaignForResponse(campaign);
};

const createEventCampaign = async ({
  eventId,
  actorUserId,
  payload,
}) => {
  const event = await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const campaign = await EventCampaign.create({
    eventId: event._id,
    organizerUserId: actorUserId,
    name: String(payload.name || "").trim(),
    channel: payload.channel || "email",
    audience: payload.audience || "all_ticket_holders",
    audienceTicketCategoryId: payload.audienceTicketCategoryId || null,
    subject: String(payload.subject || "").trim(),
    message: String(payload.message || "").trim(),
    status:
      payload.action === "schedule"
        ? "scheduled"
        : payload.action === "send_now"
          ? "sending"
          : "draft",
    scheduledAt:
      payload.action === "schedule" && payload.scheduledAt
        ? new Date(payload.scheduledAt)
        : null,
    metadata: {
      channelRequested: payload.channel || "email",
      audienceRequested: payload.audience || "all_ticket_holders",
    },
  });

  if (payload.action === "send_now") {
    return dispatchEventCampaignNow({
      campaignId: String(campaign._id),
      actorUserId,
    });
  }

  return mapCampaignForResponse(
    await campaign.populate("eventId", "name startsAt endsAt"),
  );
};

const updateEventCampaignSchedule = async ({
  eventId,
  campaignId,
  actorUserId,
  payload,
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const campaign = await EventCampaign.findOne({
    _id: campaignId,
    eventId,
  });

  if (!campaign) {
    throw new ApiError(404, "Campaign not found");
  }

  if (campaign.status === "sent") {
    throw new ApiError(409, "This campaign has already been sent");
  }

  if (payload.action === "send_now") {
    return dispatchEventCampaignNow({
      campaignId,
      actorUserId,
    });
  }

  if (payload.action === "cancel") {
    campaign.status = "cancelled";
    campaign.scheduledAt = null;
    await campaign.save();
    return mapCampaignForResponse(
      await campaign.populate("eventId", "name startsAt endsAt"),
    );
  }

  campaign.status = "scheduled";
  campaign.scheduledAt = new Date(payload.scheduledAt);
  await campaign.save();

  return mapCampaignForResponse(
    await campaign.populate("eventId", "name startsAt endsAt"),
  );
};

const quoteCsv = (value) => {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

const rowsToCsv = (rows) => {
  if (!rows.length) {
    return "";
  }

  const keys = Object.keys(rows[0]);
  const head = keys.map(quoteCsv).join(",");
  const body = rows
    .map((row) => keys.map((key) => quoteCsv(row[key])).join(","))
    .join("\n");

  return `${head}\n${body}`;
};

const toDateRangeFilter = ({ from, to, field = "createdAt" }) => {
  if (!from || !to) {
    return {};
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new ApiError(400, "Invalid date range");
  }

  if (fromDate > toDate) {
    throw new ApiError(400, "'from' cannot be later than 'to'");
  }

  return {
    [field]: {
      $gte: fromDate,
      $lte: toDate,
    },
  };
};

const formatAmount = (value) => Number(value || 0);

const buildExportSummary = (tickets = []) => {
  let totalSold = 0;
  let checkedIn = 0;
  let freeCount = 0;
  let paidCount = 0;
  let grossRevenue = 0;
  const categoryCounter = new Map();

  for (const ticket of tickets) {
    if (!["paid", "used"].includes(ticket.status)) {
      continue;
    }

    const quantity = Math.max(1, Number(ticket.quantity || 1));
    totalSold += quantity;

    if (ticket.status === "used") {
      checkedIn += quantity;
    }

    const totalPrice = formatAmount(ticket.totalPriceNaira || 0);
    grossRevenue += totalPrice;

    if (totalPrice <= 0) {
      freeCount += quantity;
    } else {
      paidCount += quantity;
    }

    const key = String(ticket.ticketCategoryName || "General");
    categoryCounter.set(key, Number(categoryCounter.get(key) || 0) + quantity);
  }

  const checkInRate = totalSold > 0 ? checkedIn / totalSold : 0;
  const topTicketType = [...categoryCounter.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0] || "General";

  return {
    totalTicketsSold: totalSold,
    totalAttendeesCheckedIn: checkedIn,
    freeTickets: freeCount,
    paidTickets: paidCount,
    grossRevenueNaira: grossRevenue,
    checkInRate: Number((checkInRate * 100).toFixed(2)),
    topTicketType,
  };
};

const buildRowsForExport = async ({ eventId, kind, from, to }) => {
  const ticketRange = toDateRangeFilter({ from, to, field: "createdAt" });
  const tickets = await EventTicket.find({
    eventId,
    ...ticketRange,
  })
    .populate("buyerUserId", "fullName email")
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();

  const summary = buildExportSummary(tickets);
  let rows = [];

  if (kind === "tickets") {
    rows = tickets.map((ticket) => ({
      ticketCode: ticket.ticketCode || "",
      buyerName:
        ticket.buyerUserId && typeof ticket.buyerUserId === "object"
          ? ticket.buyerUserId.fullName || ""
          : "",
      buyerEmail:
        ticket.buyerUserId && typeof ticket.buyerUserId === "object"
          ? ticket.buyerUserId.email || ""
          : "",
      category: ticket.ticketCategoryName || "",
      status: ticket.status || "",
      quantity: Number(ticket.quantity || 0),
      totalPriceNaira: formatAmount(ticket.totalPriceNaira),
      paidAt: ticket.paidAt ? new Date(ticket.paidAt).toISOString() : "",
      checkedInAt: ticket.usedAt ? new Date(ticket.usedAt).toISOString() : "",
      createdAt: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : "",
    }));
  } else if (kind === "attendees") {
    rows = tickets
      .filter((ticket) => ["paid", "used"].includes(ticket.status))
      .map((ticket) => ({
        buyerName:
          ticket.buyerUserId && typeof ticket.buyerUserId === "object"
            ? ticket.buyerUserId.fullName || ""
            : "",
        buyerEmail:
          ticket.buyerUserId && typeof ticket.buyerUserId === "object"
            ? ticket.buyerUserId.email || ""
            : "",
        status: ticket.status || "",
        checkedIn: ticket.status === "used" ? "yes" : "no",
        checkedInAt: ticket.usedAt ? new Date(ticket.usedAt).toISOString() : "",
        ticketCode: ticket.ticketCode || "",
      }));
  } else if (kind === "finance") {
    rows = tickets
      .filter((ticket) => ["paid", "used"].includes(ticket.status))
      .map((ticket) => {
        const pricing =
          ticket.paymentMetadata && typeof ticket.paymentMetadata === "object"
            ? ticket.paymentMetadata.pricingBreakdown || {}
            : {};

        return {
          ticketCode: ticket.ticketCode || "",
          category: ticket.ticketCategoryName || "",
          feeMode: String(pricing.feeMode || "absorbed_by_organizer"),
          basePriceNaira: formatAmount(pricing.basePriceNaira || ticket.totalPriceNaira),
          veraFeeNaira: formatAmount(pricing.veraFeeNaira || 0),
          checkoutTotalNaira: formatAmount(
            pricing.totalCheckoutNaira || ticket.totalPriceNaira,
          ),
          organizerNetNaira: formatAmount(
            pricing.organizerNetNaira || ticket.totalPriceNaira,
          ),
          paidAt: ticket.paidAt ? new Date(ticket.paidAt).toISOString() : "",
        };
      });
  } else {
    const campaigns = await EventCampaign.find({
      eventId,
      ...toDateRangeFilter({ from, to, field: "createdAt" }),
    })
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    rows = campaigns.map((campaign) => ({
      name: campaign.name || "",
      channel: campaign.channel || "",
      audience: campaign.audience || "",
      status: campaign.status || "",
      recipientsCount: Number(campaign.recipientsCount || 0),
      deliveredCount: Number(campaign.deliveredCount || 0),
      failedCount: Number(campaign.failedCount || 0),
      scheduledAt: campaign.scheduledAt
        ? new Date(campaign.scheduledAt).toISOString()
        : "",
      sentAt: campaign.sentAt ? new Date(campaign.sentAt).toISOString() : "",
      createdAt: campaign.createdAt
        ? new Date(campaign.createdAt).toISOString()
        : "",
    }));
  }

  return {
    rows,
    summary,
  };
};

const listEventExports = async ({
  eventId,
  actorUserId,
  query = {},
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const safePage = Math.max(1, Number(query.page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, totalItems] = await Promise.all([
    EventExport.find({ eventId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    EventExport.countDocuments({ eventId }),
  ]);

  return {
    items: items.map((item) => {
      const payload = item.toJSON();
      delete payload.content;
      return payload;
    }),
    ...buildPaginationMeta({
      page: safePage,
      limit: safeLimit,
      totalItems,
    }),
  };
};

const createEventExport = async ({
  eventId,
  actorUserId,
  payload,
}) => {
  const event = await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const { rows, summary } = await buildRowsForExport({
    eventId: event._id,
    kind: payload.kind,
    from: payload.from,
    to: payload.to,
  });

  const generatedAt = new Date();
  const isJson = payload.format === "json";
  const content = isJson ? JSON.stringify(rows, null, 2) : rowsToCsv(rows);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const previewRows = rows.slice(0, 20);
  const fileStem = `${String(event.name || "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "event"}-${payload.kind}-${generatedAt
    .toISOString()
    .slice(0, 10)}`;

  const created = await EventExport.create({
    eventId: event._id,
    organizerUserId: actorUserId,
    kind: payload.kind,
    format: isJson ? "json" : "csv",
    status: "ready",
    fileName: `${fileStem}.${isJson ? "json" : "csv"}`,
    mimeType: isJson ? "application/json" : "text/csv",
    rowCount: rows.length,
    generatedAt,
    dateRangeFrom: payload.from ? new Date(payload.from) : null,
    dateRangeTo: payload.to ? new Date(payload.to) : null,
    columns,
    previewRows,
    summary,
    content,
  });

  const result = created.toJSON();
  delete result.content;
  return result;
};

const getEventExportById = async ({
  eventId,
  exportId,
  actorUserId,
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const exportJob = await EventExport.findOne({
    _id: exportId,
    eventId,
  });

  if (!exportJob) {
    throw new ApiError(404, "Export not found");
  }

  const result = exportJob.toJSON();
  delete result.content;
  return result;
};

const getEventExportPreview = async ({
  eventId,
  exportId,
  actorUserId,
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const exportJob = await EventExport.findOne({
    _id: exportId,
    eventId,
  });

  if (!exportJob) {
    throw new ApiError(404, "Export not found");
  }

  return {
    _id: String(exportJob._id),
    fileName: exportJob.fileName,
    format: exportJob.format,
    mimeType: exportJob.mimeType,
    rowCount: Number(exportJob.rowCount || 0),
    generatedAt: exportJob.generatedAt,
    columns: exportJob.columns || [],
    previewRows: exportJob.previewRows || [],
    summary: exportJob.summary || {},
  };
};

const getEventExportDownload = async ({
  eventId,
  exportId,
  actorUserId,
}) => {
  await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const exportJob = await EventExport.findOne({
    _id: exportId,
    eventId,
  });

  if (!exportJob) {
    throw new ApiError(404, "Export not found");
  }

  return exportJob;
};

const getMyOrganizerBranding = async ({ actorUserId }) => {
  const user = await User.findById(actorUserId).select(
    "fullName organizerBranding subscriptionTier subscriptionStatus premiumExpiresAt premiumActivatedAt",
  );

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const { subscription } = await syncUserSubscriptionState({ user });

  return {
    user: {
      _id: String(user._id),
      fullName: user.fullName,
    },
    subscription,
    branding: normalizeBranding(user.organizerBranding || {}, DEFAULT_BRANDING),
  };
};

const updateMyOrganizerBranding = async ({ actorUserId, payload }) => {
  await requirePremiumAccess(actorUserId);

  const user = await User.findById(actorUserId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const next = normalizeBranding(
    {
      ...(user.organizerBranding || {}),
      ...payload,
      updatedAt: new Date(),
    },
    DEFAULT_BRANDING,
  );

  user.organizerBranding = {
    ...next,
    updatedAt: new Date(),
  };
  await user.save();

  return {
    branding: normalizeBranding(user.organizerBranding || {}, DEFAULT_BRANDING),
  };
};

const getEventBranding = async ({ eventId, actorUserId }) => {
  const event = await requireEventCreator({ eventId, actorUserId });
  const organizer =
    event.organizerUserId && typeof event.organizerUserId === "object"
      ? event.organizerUserId
      : null;

  return {
    event: {
      _id: String(event._id),
      name: event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
    branding: {
      organizerDefault: normalizeBranding(
        organizer?.organizerBranding || {},
        DEFAULT_BRANDING,
      ),
      eventOverride: {
        useOrganizerDefault: Boolean(event.branding?.useOrganizerDefault !== false),
        overrideEnabled: Boolean(event.branding?.overrideEnabled),
        ...normalizeBranding(
          event.branding || {},
          organizer?.organizerBranding || DEFAULT_BRANDING,
        ),
      },
      resolved: resolveBranding({
        organizerBranding: organizer?.organizerBranding,
        eventBranding: event.branding,
      }),
    },
  };
};

const updateEventBranding = async ({ eventId, actorUserId, payload }) => {
  const event = await requireEventCreator({ eventId, actorUserId });
  await requirePremiumAccess(actorUserId);

  const current = event.branding || {};
  const next = {
    ...current,
    ...payload,
    useOrganizerDefault:
      payload.useOrganizerDefault !== undefined
        ? Boolean(payload.useOrganizerDefault)
        : current.useOrganizerDefault !== false,
    overrideEnabled:
      payload.overrideEnabled !== undefined
        ? Boolean(payload.overrideEnabled)
        : Boolean(current.overrideEnabled),
    updatedAt: new Date(),
  };

  event.branding = {
    ...next,
    ...normalizeBranding(next, DEFAULT_BRANDING),
  };
  await event.save();

  const hydrated = await Event.findById(event._id).populate(
    "organizerUserId",
    "fullName email organizerBranding",
  );

  return getEventBranding({
    eventId: String(hydrated?._id || event._id),
    actorUserId,
  });
};

const runEventCampaignTick = async () => {
  if (campaignTickRunning || !isDbConnected()) {
    return;
  }

  campaignTickRunning = true;

  try {
    const now = new Date();
    const dueCampaigns = await EventCampaign.find({
      status: "scheduled",
      scheduledAt: { $lte: now },
    })
      .select("_id organizerUserId")
      .sort({ scheduledAt: 1 })
      .limit(120)
      .lean();

    for (const campaign of dueCampaigns) {
      try {
        await dispatchEventCampaignNow({
          campaignId: String(campaign._id),
          actorUserId: String(campaign.organizerUserId),
          skipPremiumValidation: true,
        });
      } catch (error) {
        const failed = await EventCampaign.findById(campaign._id);

        if (failed) {
          failed.status = "failed";
          failed.lastError =
            error instanceof Error ? error.message : String(error);
          await failed.save();
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EventCampaign] Tick failed", error);
  } finally {
    campaignTickRunning = false;
  }
};

const startEventCampaignMonitor = () => {
  if (!env.eventCampaignEnabled) {
    // eslint-disable-next-line no-console
    console.log("[EventCampaign] Disabled via EVENT_CAMPAIGN_ENABLED=false");
    return;
  }

  if (campaignIntervalHandle) {
    return;
  }

  campaignIntervalHandle = setInterval(() => {
    void runEventCampaignTick();
  }, campaignTickMs);

  void runEventCampaignTick();

  // eslint-disable-next-line no-console
  console.log(`[EventCampaign] Started (tick=${campaignTickMs}ms)`);
};

const stopEventCampaignMonitor = () => {
  if (!campaignIntervalHandle) {
    return;
  }

  clearInterval(campaignIntervalHandle);
  campaignIntervalHandle = null;
  campaignTickRunning = false;
};

module.exports = {
  resolveBranding,
  getMyOrganizerBranding,
  updateMyOrganizerBranding,
  getEventBranding,
  updateEventBranding,
  listEventCampaigns,
  createEventCampaign,
  getEventCampaignById,
  updateEventCampaignSchedule,
  listEventExports,
  createEventExport,
  getEventExportById,
  getEventExportPreview,
  getEventExportDownload,
  dispatchEventCampaignNow,
  runEventCampaignTick,
  startEventCampaignMonitor,
  stopEventCampaignMonitor,
};
