const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const Event = require("../models/event.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { nairaToKobo } = require("./wallet.service");
const { initiatePaystackRefund } = require("./paystack.service");

const toIdString = (value) => String(value?._id || value || "");

/**
 * Refunds a paid ticket: returns the attendee's money via Paystack, flips
 * the ticket to "refunded", and reverses whatever the organizer's wallet
 * was credited for this sale, from pendingBalanceKobo if the sale hasn't
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
      null,
      "TICKET_NOT_REFUNDABLE",
    );
  }

  if (!ticket.paymentReference) {
    throw new ApiError(
      422,
      "This ticket has no payment reference to refund",
      null,
      "NO_PAYMENT_REFERENCE",
    );
  }

  const originalStatus = ticket.status;

  // Atomically claim the ticket for refunding BEFORE calling Paystack, so a
  // concurrent double-request can only ever trigger one real provider
  // refund call. The loser gets a clean 409 instead of a second charge
  // reversal.
  const claimedTicket = await EventTicket.findOneAndUpdate(
    { _id: ticketId, status: { $in: ["paid", "used"] } },
    { $set: { status: "refunded", refundedAt: new Date() } },
    { new: true },
  );

  if (!claimedTicket) {
    throw new ApiError(409, "Ticket was already refunded", null, "TICKET_ALREADY_REFUNDED");
  }

  try {
    await initiatePaystackRefund({
      transactionReference: ticket.paymentReference,
      amountKobo: nairaToKobo(ticket.totalPriceNaira),
    });
  } catch (error) {
    // Provider call failed. Release the claim so this is retryable rather
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
      // event had zero organizerNet). Nothing to reverse on the ledger.
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
    // transaction anyway. MongoDB poisons a transaction for commit the
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

/**
 * Reverses one add-on line.
 *
 * Its own function rather than a branch inside refundTicket because the
 * amounts live on separate ledger rows: an add-on's credit is keyed
 * `add_on_sale:<purchaseId>`, and every add-on shares its ticket's id, so
 * looking one up by ticketId would reverse the wrong money.
 *
 * The attendee's cash is returned by the ticket's own Paystack refund when a
 * whole order is cancelled; this reverses the organizer's side of it.
 */
const refundAddOnPurchase = async ({ purchaseId, reason }) => {
  /* Atomic claim, so two sweeps cannot both reverse the same credit. */
  const purchase = await EventAddOnPurchase.findOneAndUpdate(
    { _id: purchaseId, status: { $in: ["paid", "redeemed"] } },
    { $set: { status: "refunded", refundedAt: new Date() } },
    { new: true },
  );

  if (!purchase) {
    return null;
  }

  await withMongoTransaction(async (session) => {
    const saleTransaction = await WalletTransaction.findOne({
      idempotencyKey: `add_on_sale:${purchaseId}`,
    }).session(session);

    if (!saleTransaction) {
      /* Crediting was off, or the line was free. Nothing on the ledger. */
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

    await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          organizerUserId: purchase.organizerUserId,
          type: "refund",
          amountKobo: -amountKobo,
          bucket: isPreSettlement ? "pending" : "available",
          status: "completed",
          eventId: purchase.eventId,
          ticketId: purchase.ticketId,
          sourceTransactionId: saleTransaction._id,
          idempotencyKey: `refund:add_on:${purchaseId}`,
          description: `Refund (${purchase.name}): ${String(
            reason || "requested",
          ).slice(0, 160)}`,
        },
      ],
      { session },
    );
  });

  return purchase;
};

/** Every add-on still held against a ticket, optionally only the ones that
 *  do not follow it to a new owner. */
const refundTicketAddOns = async ({ ticketId, reason, onlyNonTransferable = false }) => {
  const held = await EventAddOnPurchase.find({
    ticketId,
    status: { $in: ["paid", "redeemed"] },
  });

  const refunded = [];

  for (const purchase of held) {
    if (onlyNonTransferable) {
      const event = await Event.findById(purchase.eventId).select("addOns");
      const definition = (event?.addOns || []).find(
        (addOn) => String(addOn._id) === String(purchase.addOnId),
      );

      if (definition?.transfersOnResale !== false) {
        continue;
      }
    }

    const result = await refundAddOnPurchase({ purchaseId: purchase._id, reason });

    if (result) {
      refunded.push(result);
    }
  }

  return refunded;
};

module.exports = { refundTicket, refundAddOnPurchase, refundTicketAddOns };
