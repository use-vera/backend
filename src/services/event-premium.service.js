const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventExport = require("../models/event-export.model");
const { syncUserSubscriptionState } = require("./subscription.service");

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
    "fullName email",
  );

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (toIdString(event.organizerUserId) !== toIdString(actorUserId)) {
    throw new ApiError(403, "Only the event creator can manage this feature");
  }

  return event;
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

module.exports = {
  listEventExports,
  createEventExport,
  getEventExportById,
  getEventExportPreview,
  getEventExportDownload,
};
