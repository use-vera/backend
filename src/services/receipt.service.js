const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const { sendEmail } = require("./email.service");
const { ticketReceipt } = require("../emails/receipt.emails");

const toId = (value) => String(value?._id || value || "");
const round = (value) => Math.round(Number(value || 0));

/* Paystack's authorization block, reduced to what a receipt shows. */
const describeMethod = (attempt) => {
  const auth = attempt?.paystackVerifyPayload?.authorization;
  if (!auth) return null;
  return {
    channel: String(auth.channel || attempt.paystackVerifyPayload?.channel || ""),
    brand: String(auth.card_type || auth.brand || "").trim(),
    last4: String(auth.last4 || ""),
    bank: String(auth.bank || ""),
  };
};

/**
 * The receipt for the order a ticket belongs to: every seat bought in that
 * checkout, its add-ons, and any later upgrade paid for on the ticket.
 *
 * Only the person who paid can see it. A ticket that was sent to you or that
 * you were let in on has someone else's payment behind it, and their price
 * and card are theirs.
 */
const getTicketReceipt = async ({ ticketId, actorUserId }) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  if (!ticket.paymentReference || round(ticket.totalPriceNaira) <= 0) {
    throw new ApiError(404, "Free tickets don't have a receipt", null, "NO_RECEIPT");
  }

  const attempt = await PaymentAttempt.findOne({ reference: ticket.paymentReference });
  const payerId = attempt ? toId(attempt.buyerUserId) : toId(ticket.buyerUserId);

  if (payerId !== String(actorUserId)) {
    throw new ApiError(
      403,
      "Only the person who paid can see this receipt.",
      null,
      "RECEIPT_NOT_YOURS",
    );
  }

  const [event, payer] = await Promise.all([
    Event.findById(ticket.eventId).select("name startsAt address organizerUserId").populate("organizerUserId", "fullName"),
    User.findById(payerId).select("fullName email"),
  ]);

  const isResale = attempt?.kind === "ticket_resale_purchase";
  const batchId = ticket.paymentMetadata?.purchaseBatchId;

  /* Every seat paid for on this payment. */
  const seats = isResale
    ? [ticket]
    : await EventTicket.find(
        batchId
          ? { "paymentMetadata.purchaseBatchId": batchId, paymentReference: ticket.paymentReference }
          : { _id: ticket._id },
      );

  const lines = [];
  const seatCount = seats.reduce((total, seat) => total + Math.max(1, Number(seat.quantity || 1)), 0);
  const tierName = ticket.ticketCategoryName || "Ticket";

  if (isResale) {
    lines.push({
      kind: "ticket",
      label: `${seatCount} × ${tierName} (resale)`,
      amountNaira: round(attempt.amountKobo / 100),
    });
  } else {
    let baseTotal = 0;
    let feeTotal = 0;
    let discountTotal = 0;

    for (const seat of seats) {
      const pricing = seat.paymentMetadata?.pricingBreakdown || {};
      const base = pricing.basePriceNaira ?? seat.totalPriceNaira;
      baseTotal += round(base);
      if (pricing.feeMode === "passed_to_attendee") {
        feeTotal += round(pricing.veraFeeNaira);
      }
      discountTotal += round(pricing.promoDiscountNaira);
    }

    const addOns = await EventAddOnPurchase.find({
      paymentReference: ticket.paymentReference,
      status: { $in: ["paid", "redeemed", "refunded"] },
    });

    lines.push({ kind: "ticket", label: `${seatCount} × ${tierName}`, amountNaira: baseTotal });

    for (const addOn of addOns) {
      const pricing = addOn.pricingBreakdown || {};
      lines.push({
        kind: "addon",
        label: `${addOn.quantity > 1 ? `${addOn.quantity} × ` : ""}${addOn.name}${addOn.variantName ? ` (${addOn.variantName})` : ""}`,
        amountNaira: round(pricing.basePriceNaira ?? addOn.unitPriceNaira * addOn.quantity),
      });
      if (pricing.feeMode === "passed_to_attendee") {
        feeTotal += round(pricing.veraFeeNaira);
      }
    }

    if (discountTotal > 0) {
      lines.push({ kind: "discount", label: "Promo discount", amountNaira: -discountTotal });
    }
    if (feeTotal > 0) {
      lines.push({ kind: "fee", label: "Service fee", amountNaira: feeTotal });
    }
  }

  /* What the payment provider actually took is the total; the lines above
     explain it. */
  const paidNaira = attempt ? round(attempt.amountKobo / 100) : lines.reduce((sum, line) => sum + line.amountNaira, 0);

  /* Upgrades are separate payments on the same ticket. */
  const upgrades = await PaymentAttempt.find({
    ticketId: ticket._id,
    kind: "ticket_upgrade",
    status: "success",
    buyerUserId: actorUserId,
  }).sort({ createdAt: 1 });

  const upgradeLines = upgrades.map((upgrade) => ({
    kind: "upgrade",
    label: `Upgrade on ${new Date(upgrade.fulfilledAt || upgrade.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}`,
    amountNaira: round(upgrade.amountKobo / 100),
  }));

  const refunded = seats.filter((seat) => seat.status === "refunded");

  return {
    receiptNumber: `VR-${String(ticket.paymentReference).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`,
    status: refunded.length === 0 ? "paid" : refunded.length === seats.length ? "refunded" : "partially_refunded",
    event: event
      ? {
          _id: String(event._id),
          name: event.name,
          startsAt: event.startsAt,
          address: event.address || "",
          organizerName: event.organizerUserId?.fullName || "",
        }
      : null,
    billedTo: { name: payer?.fullName || ticket.attendeeName || "", email: payer?.email || ticket.attendeeEmail || "" },
    paidAt: attempt?.fulfilledAt || ticket.paidAt || null,
    method: describeMethod(attempt),
    reference: ticket.paymentReference,
    lines,
    totalNaira: paidNaira,
    upgrades: upgradeLines,
    grandTotalNaira: paidNaira + upgradeLines.reduce((sum, line) => sum + line.amountNaira, 0),
    refundedAt: refunded[0]?.refundedAt || null,
    refundedNaira: refunded.reduce((sum, seat) => sum + round(seat.totalPriceNaira), 0),
  };
};

/** Emails the receipt to the payer's own account address, nowhere else. */
const emailTicketReceipt = async ({ ticketId, actorUserId }) => {
  const receipt = await getTicketReceipt({ ticketId, actorUserId });

  if (!receipt.billedTo.email) {
    throw new ApiError(422, "Your account has no email address to send this to");
  }

  await sendEmail({ to: receipt.billedTo.email, ...ticketReceipt({ receipt }) });

  return { sentTo: receipt.billedTo.email };
};

module.exports = { getTicketReceipt, emailTicketReceipt };
