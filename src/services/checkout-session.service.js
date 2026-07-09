const ApiError = require("../utils/api-error");
const CheckoutSession = require("../models/checkout-session.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { findOrCreateApiPurchaser } = require("./api-purchaser.service");
const { initializeTicketPurchase, verifyTicketPayment } = require("./event.service");
const { mapOrderTicket } = require("./v1-mappers");

// Mirrors countReservedTickets' existing "pending" reservation cutoff
// (event.service.js) so a checkout session's reservation window matches the
// window the rest of the purchase pipeline already treats as "still held".
const PENDING_RESERVATION_MS = 30 * 60 * 1000;

const buildCheckoutSessionResponse = (session, { pricingBreakdown, tickets } = {}) => ({
  id: String(session._id),
  status: session.status,
  requiresPayment: session.requiresPayment,
  checkoutUrl: session.checkoutUrl,
  eventId: String(session.eventId),
  quantity: session.quantity,
  ticketIds: session.ticketIds.map(String),
  customerEmail: session.customerEmail,
  metadata: session.metadata,
  expiresAt: session.expiresAt,
  purchasedAt: session.purchasedAt,
  createdAt: session.createdAt,
  ...(pricingBreakdown ? { pricingBreakdown } : {}),
  ...(tickets ? { tickets: tickets.map(mapOrderTicket) } : {}),
});

const createCheckoutSession = async ({ apiKeyId, workspaceId, payload, idempotencyKey }) => {
  if (idempotencyKey) {
    const existing = await CheckoutSession.findOne({
      apiKeyId,
      clientIdempotencyKey: idempotencyKey,
    });

    if (existing) {
      return buildCheckoutSessionResponse(existing);
    }
  }

  const event = await Event.findById(payload.eventId);

  if (!event || String(event.workspaceId) !== String(workspaceId)) {
    throw new ApiError(404, "Event not found", null, "NOT_FOUND");
  }

  const buyer = await findOrCreateApiPurchaser({
    email: payload.customerEmail,
    fullName: payload.customerName,
  });

  // Load-bearing reuse point: every capacity/pricing/Paystack/wallet-crediting
  // rule the dashboard purchase flow already enforces runs here, unchanged.
  const result = await initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: {
      quantity: payload.quantity,
      ticketCategoryId: payload.ticketCategoryId,
      email: payload.customerEmail,
      attendeeName: payload.customerName,
      callbackUrl: payload.successUrl,
    },
  });

  const now = new Date();
  const status = result.requiresPayment ? "reserved" : "purchased";

  const session = await CheckoutSession.create({
    workspaceId,
    apiKeyId,
    eventId: event._id,
    buyerUserId: buyer._id,
    quantity: payload.quantity,
    ticketCategoryId: payload.ticketCategoryId || null,
    ticketIds: result.ticketIds || [],
    paymentAttemptId: result.paymentAttemptId || null,
    status,
    requiresPayment: result.requiresPayment,
    // Raw Paystack authorizationUrl — there is no Vera-hosted checkout page
    // yet in this phase. See the model comment for the planned follow-up.
    checkoutUrl: result.payment?.authorizationUrl || "",
    successUrl: payload.successUrl || "",
    cancelUrl: payload.cancelUrl || "",
    customerEmail: payload.customerEmail,
    metadata: payload.metadata || {},
    // undefined (not null) when absent — see the model field comment: the
    // sparse unique index only works if the field is truly missing.
    clientIdempotencyKey: idempotencyKey || undefined,
    expiresAt: result.requiresPayment
      ? new Date(now.getTime() + PENDING_RESERVATION_MS)
      : now,
    purchasedAt: status === "purchased" ? now : null,
  });

  return buildCheckoutSessionResponse(session, {
    pricingBreakdown: result.pricingBreakdown,
  });
};

const getCheckoutSession = async ({ workspaceId, sessionId }) => {
  const session = await CheckoutSession.findById(sessionId);

  if (!session || String(session.workspaceId) !== String(workspaceId)) {
    throw new ApiError(404, "Checkout session not found", null, "NOT_FOUND");
  }

  if (session.status === "reserved" && session.ticketIds.length) {
    try {
      await verifyTicketPayment({
        ticketId: session.ticketIds[0],
        actorUserId: session.buyerUserId,
      });
      session.status = "purchased";
      session.purchasedAt = new Date();
      await session.save();
    } catch (error) {
      // 402 "Payment has not been completed" just means still pending — not
      // an error from the session's point of view. Anything else (e.g. a
      // genuine provider/config failure) propagates.
      if (!(error instanceof ApiError) || error.statusCode !== 402) {
        throw error;
      }
    }
  }

  if (session.status === "reserved" && session.expiresAt <= new Date()) {
    // Defensive read-time fallback — the checkout-session monitor should
    // normally have already flipped this, but a GET immediately after
    // expiry shouldn't show a stale "reserved" status.
    session.status = "expired";
    await session.save();
  }

  const tickets = session.ticketIds.length
    ? await EventTicket.find({ _id: { $in: session.ticketIds } })
    : [];

  return buildCheckoutSessionResponse(session, { tickets });
};

module.exports = { createCheckoutSession, getCheckoutSession };
