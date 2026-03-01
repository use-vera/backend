const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const PaymentEventLog = require("../models/payment-event-log.model");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const toIdString = (value) => String(value?._id || value || "");

const createPaymentEventLog = async ({
  provider = "paystack",
  eventType = "",
  reference = "",
  paymentAttemptId = null,
  status = "received",
  message = "",
  payload = null,
  meta = null,
}) =>
  PaymentEventLog.create({
    provider,
    eventType: String(eventType || "").trim(),
    reference: String(reference || "").trim(),
    paymentAttemptId: paymentAttemptId || null,
    status,
    message: String(message || "").trim(),
    payload,
    meta,
  });

const listPaymentAttempts = async ({
  actorUserId,
  page,
  limit,
  status,
  kind,
  scope,
  eventId,
  search,
}) => {
  const pageNumber = Math.max(1, Number(page || 1));
  const limitNumber = Math.min(50, Math.max(1, Number(limit || 20)));
  const normalizedScope = String(scope || "mine").trim().toLowerCase();
  const normalizedStatus = String(status || "all").trim().toLowerCase();
  const normalizedKind = String(kind || "all").trim().toLowerCase();
  const normalizedEventId = String(eventId || "").trim();
  const normalizedSearch = String(search || "").trim();
  const query = {};

  if (normalizedScope === "organizer") {
    if (normalizedEventId) {
      if (!objectIdRegex.test(normalizedEventId)) {
        throw new ApiError(400, "Event ID must be a valid identifier");
      }

      const event = await Event.findById(normalizedEventId).select(
        "organizerUserId",
      );

      if (!event) {
        throw new ApiError(404, "Event not found");
      }

      if (toIdString(event.organizerUserId) !== String(actorUserId)) {
        throw new ApiError(403, "You can only inspect payment attempts for your events");
      }

      query.eventId = event._id;
    } else {
      const organizerEvents = await Event.find({
        organizerUserId: actorUserId,
      }).select("_id");

      if (!organizerEvents.length) {
        return {
          items: [],
          ...buildPaginationMeta({
            page: pageNumber,
            limit: limitNumber,
            totalItems: 0,
          }),
        };
      }

      query.eventId = {
        $in: organizerEvents.map((item) => item._id),
      };
    }
  } else {
    query.buyerUserId = actorUserId;

    if (normalizedEventId) {
      if (!objectIdRegex.test(normalizedEventId)) {
        throw new ApiError(400, "Event ID must be a valid identifier");
      }

      query.eventId = normalizedEventId;
    }
  }

  if (
    normalizedStatus &&
    normalizedStatus !== "all" &&
    ["initialized", "success", "failed", "abandoned", "expired"].includes(
      normalizedStatus,
    )
  ) {
    query.status = normalizedStatus;
  }

  if (
    normalizedKind &&
    normalizedKind !== "all" &&
    ["ticket_purchase", "ticket_resale_purchase"].includes(normalizedKind)
  ) {
    query.kind = normalizedKind;
  }

  if (normalizedSearch) {
    const regex = new RegExp(escapeRegex(normalizedSearch), "i");
    query.$or = [{ reference: regex }, { failureReason: regex }];
  }

  const totalItems = await PaymentAttempt.countDocuments(query);
  const items = await PaymentAttempt.find(query)
    .populate("buyerUserId", "fullName email avatarUrl title")
    .populate("eventId", "name imageUrl startsAt endsAt status organizerUserId")
    .sort({ createdAt: -1 })
    .skip((pageNumber - 1) * limitNumber)
    .limit(limitNumber);

  return {
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const getPaymentAttemptDetails = async ({ attemptId, actorUserId }) => {
  if (!objectIdRegex.test(String(attemptId || "").trim())) {
    throw new ApiError(400, "Payment attempt ID must be a valid identifier");
  }

  const attempt = await PaymentAttempt.findById(attemptId)
    .populate("buyerUserId", "fullName email avatarUrl title")
    .populate("eventId", "name imageUrl startsAt endsAt status organizerUserId")
    .populate("ticketId", "ticketCode status totalPriceNaira quantity")
    .populate("resaleSourceTicketId", "ticketCode status totalPriceNaira quantity")
    .populate("fulfillmentTicketId", "ticketCode status totalPriceNaira quantity");

  if (!attempt) {
    throw new ApiError(404, "Payment attempt not found");
  }

  const isBuyer = toIdString(attempt.buyerUserId) === String(actorUserId);
  const isOrganizer =
    attempt.eventId &&
    typeof attempt.eventId === "object" &&
    toIdString(attempt.eventId.organizerUserId) === String(actorUserId);

  if (!isBuyer && !isOrganizer) {
    throw new ApiError(403, "You do not have access to this payment attempt");
  }

  const logs = await PaymentEventLog.find({
    $or: [
      { paymentAttemptId: attempt._id },
      { reference: String(attempt.reference || "").trim() },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(20);

  return {
    attempt,
    logs,
  };
};

module.exports = {
  createPaymentEventLog,
  listPaymentAttempts,
  getPaymentAttemptDetails,
};
