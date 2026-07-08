const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { getOrCreateWallet } = require("./wallet.service");

/**
 * Admin-only wallet-side reaction to a chargeback/dispute. No Paystack call
 * here — real Paystack dispute webhooks (charge.dispute.*) are a separate,
 * later follow-up; this is the debit logic they'll eventually call into.
 * Same "debit available, spill into owingBalanceKobo if insufficient"
 * mechanics as a post-settlement refund.
 */
const applyChargeback = async ({ ticketId, actorUserId, amountKobo, reason }) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  const normalizedAmount = Math.max(1, Math.round(Number(amountKobo || 0)));

  return withMongoTransaction(async (session) => {
    const wallet = await getOrCreateWallet(ticket.organizerUserId, session);
    const shortfallKobo = Math.max(0, normalizedAmount - wallet.availableBalanceKobo);
    const availableDebitKobo = normalizedAmount - shortfallKobo;

    const updatedWallet = await OrganizerWallet.findOneAndUpdate(
      { _id: wallet._id },
      {
        $inc: {
          availableBalanceKobo: -availableDebitKobo,
          owingBalanceKobo: shortfallKobo,
          version: 1,
        },
      },
      { session, new: true },
    );

    const [chargeback] = await WalletTransaction.create(
      [
        {
          walletId: updatedWallet._id,
          organizerUserId: ticket.organizerUserId,
          type: "chargeback",
          amountKobo: -normalizedAmount,
          bucket: "available",
          status: "completed",
          eventId: ticket.eventId,
          ticketId: ticket._id,
          idempotencyKey: `chargeback:${ticketId}:${Date.now()}`,
          description: `Chargeback applied by admin: ${String(reason || "").slice(0, 200)}`,
          metadata: { appliedByAdminUserId: actorUserId },
        },
      ],
      { session },
    );

    return chargeback;
  });
};

module.exports = { applyChargeback };
