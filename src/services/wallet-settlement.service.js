const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const Event = require("../models/event.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");

const DEFAULT_BATCH_SIZE = 200;

/**
 * Settles one candidate transaction. The atomic claim (pending_settlement ->
 * settled) happens INSIDE the same transaction as the wallet balance move
 * and the settlement-record insert — not as a separate step before it — so
 * a mid-way failure rolls the claim back too. Two overlapping tick runs
 * racing on the same transaction resolve via Mongo's write-conflict
 * detection: the loser's claim re-read (on retry) sees status is already
 * "settled" and returns null, which this treats as already-done.
 */
const settleOneTransaction = async (transactionId) =>
  withMongoTransaction(async (session) => {
    const claimed = await WalletTransaction.findOneAndUpdate(
      { _id: transactionId, status: "pending_settlement" },
      { $set: { status: "settled" } },
      { session, new: true },
    );

    if (!claimed) {
      return "skipped";
    }

    await OrganizerWallet.updateOne(
      { _id: claimed.walletId },
      {
        $inc: {
          pendingBalanceKobo: -claimed.amountKobo,
          availableBalanceKobo: claimed.amountKobo,
          version: 1,
        },
      },
      { session },
    );

    // No pre-check needed here (unlike creditTicketSale): the atomic claim
    // above already guarantees a given source transaction can be claimed
    // exactly once, ever, so this insert's idempotencyKey can never
    // legitimately collide. If it somehow did, letting it throw (aborting
    // and retrying via withMongoTransaction) is correct — a caught-and-
    // swallowed error here would NOT save the transaction anyway, since
    // MongoDB poisons a transaction for commit the moment any operation
    // inside it fails, regardless of whether the app catches that error.
    await WalletTransaction.create(
      [
        {
          walletId: claimed.walletId,
          organizerUserId: claimed.organizerUserId,
          type: "settlement",
          amountKobo: claimed.amountKobo,
          bucket: "available",
          status: "completed",
          eventId: claimed.eventId,
          ticketId: claimed.ticketId,
          sourceTransactionId: claimed._id,
          idempotencyKey: `settlement:${claimed._id}`,
          description: "Moved from pending to available balance",
        },
      ],
      { session },
    );

    return "settled";
  });

/**
 * One tick: find pending_settlement ticket_sale/platform_fee transactions
 * whose settlementEligibleAt has passed, skip any tied to a cancelled event
 * (those go through the refund path instead), and settle the rest.
 */
const runSettlementTick = async ({ batchSize = DEFAULT_BATCH_SIZE } = {}) => {
  const now = new Date();

  const candidates = await WalletTransaction.find({
    type: { $in: ["ticket_sale", "platform_fee"] },
    status: "pending_settlement",
    settlementEligibleAt: { $lte: now },
  })
    .select("_id eventId")
    .limit(batchSize)
    .lean();

  if (!candidates.length) {
    return { claimed: 0, settled: 0, skipped: 0 };
  }

  const eventIds = [
    ...new Set(candidates.filter((c) => c.eventId).map((c) => String(c.eventId))),
  ];

  const cancelledEventIds = new Set(
    (
      await Event.find({ _id: { $in: eventIds }, status: "cancelled" })
        .select("_id")
        .lean()
    ).map((e) => String(e._id)),
  );

  let settled = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (candidate.eventId && cancelledEventIds.has(String(candidate.eventId))) {
      skipped += 1;
      continue;
    }

    const outcome = await settleOneTransaction(candidate._id);

    if (outcome === "settled") {
      settled += 1;
    } else {
      skipped += 1;
    }
  }

  return { claimed: candidates.length, settled, skipped };
};

const triggerManualSettlement = async ({ actorUserId, batchSize } = {}) =>
  runSettlementTick({ batchSize, actorUserId });

module.exports = {
  runSettlementTick,
  triggerManualSettlement,
};
