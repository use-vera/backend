const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { nairaToKobo } = require("./wallet.service");
const { initiatePaystackRefund } = require("./paystack.service");

const toIdString = (value) => String(value?._id || value || "");

/**
 * Refunds a paid ticket: returns the attendee's money via Paystack, flips
 * the ticket to "refunded", and reverses whatever the organizer's wallet
 * was credited for this sale — from pendingBalanceKobo if the sale hasn't
 * settled yet, or from availableBalanceKobo (going into owingBalanceKobo if
 * insufficient) if it has.
 */
const refundTicket = async ({ ticketId, actorUserId, reason }) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  const isBuyer = toIdString(ticket.buyerUserId) === String(actorUserId);
  const isOrganizer = toIdString(ticket.organizerUserId) === String(actorUserId);

  if (!isBuyer && !isOrganizer) {
    throw new ApiError(403, "You cannot refund this ticket");
  }

  if (!["paid", "used"].includes(ticket.status)) {
    throw new ApiError(
      409,
      `A ticket with status "${ticket.status}" cannot be refunded`,
    );
  }

  if (!ticket.paymentReference) {
    throw new ApiError(422, "This ticket has no payment reference to refund");
  }

  const originalStatus = ticket.status;

  // Atomically claim the ticket for refunding BEFORE calling Paystack, so a
  // concurrent double-request can only ever trigger one real provider
  // refund call — the loser gets a clean 409 instead of a second charge
  // reversal.
  const claimedTicket = await EventTicket.findOneAndUpdate(
    { _id: ticketId, status: { $in: ["paid", "used"] } },
    { $set: { status: "refunded", refundedAt: new Date() } },
    { new: true },
  );

  if (!claimedTicket) {
    throw new ApiError(409, "Ticket was already refunded");
  }

  try {
    await initiatePaystackRefund({
      transactionReference: ticket.paymentReference,
      amountKobo: nairaToKobo(ticket.totalPriceNaira),
    });
  } catch (error) {
    // Provider call failed — release the claim so this is retryable rather
    // than leaving the ticket stuck "refunded" with no money returned.
    await EventTicket.updateOne(
      { _id: ticketId, status: "refunded" },
      { $set: { status: originalStatus }, $unset: { refundedAt: "" } },
    );

    throw error;
  }

  await withMongoTransaction(async (session) => {
    const saleTransaction = await WalletTransaction.findOne({
      ticketId,
      type: "ticket_sale",
    }).session(session);

    if (!saleTransaction) {
      // Wallet crediting wasn't enabled when this ticket was bought (or the
      // event had zero organizerNet) — nothing to reverse on the ledger.
      return;
    }

    const wallet = await OrganizerWallet.findById(saleTransaction.walletId).session(
      session,
    );

    if (!wallet) {
      return;
    }

    const amountKobo = saleTransaction.amountKobo;
    const isPreSettlement = saleTransaction.status === "pending_settlement";

    if (isPreSettlement) {
      await OrganizerWallet.updateOne(
        { _id: wallet._id },
        {
          $inc: {
            pendingBalanceKobo: -amountKobo,
            lifetimeRefundedKobo: amountKobo,
            version: 1,
          },
        },
        { session },
      );
    } else {
      const shortfallKobo = Math.max(0, amountKobo - wallet.availableBalanceKobo);
      const availableDebitKobo = amountKobo - shortfallKobo;

      await OrganizerWallet.updateOne(
        { _id: wallet._id },
        {
          $inc: {
            availableBalanceKobo: -availableDebitKobo,
            owingBalanceKobo: shortfallKobo,
            lifetimeRefundedKobo: amountKobo,
            version: 1,
          },
        },
        { session },
      );
    }

    // No pre-check needed: the ticket-level atomic claim above (status
    // paid/used -> refunded) already guarantees this ticket can be
    // refunded exactly once, so `refund:${ticketId}` can never legitimately
    // collide. Catching a duplicate-key error here wouldn't save this
    // transaction anyway — MongoDB poisons a transaction for commit the
    // moment any operation inside it fails, regardless of whether the app
    // catches that rejection.
    await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          organizerUserId: ticket.organizerUserId,
          type: "refund",
          amountKobo: -amountKobo,
          bucket: isPreSettlement ? "pending" : "available",
          status: "completed",
          eventId: ticket.eventId,
          ticketId: ticket._id,
          sourceTransactionId: saleTransaction._id,
          idempotencyKey: `refund:${ticketId}`,
          description: `Refund: ${String(reason || "requested").slice(0, 200)}`,
        },
      ],
      { session },
    );
  });

  return claimedTicket;
};

module.exports = { refundTicket };
