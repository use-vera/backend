const ApiError = require("../utils/api-error");
const env = require("../config/env");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const PayoutAccount = require("../models/payout-account.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { getOrCreateWallet, buildPaginationMeta } = require("./wallet.service");
const { initiatePaystackTransfer } = require("./paystack.service");

/**
 * Reverses a withdrawal that was reserved but never completed (provider
 * transfer failed to initiate, or Paystack later reports transfer.failed).
 * Idempotent: only acts on a withdrawal still in reserved/processing —
 * calling it twice for the same withdrawal is a safe no-op the second time.
 */
const reverseWithdrawal = async ({ withdrawalId, reason }) =>
  withMongoTransaction(async (session) => {
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: withdrawalId, status: { $in: ["reserved", "processing"] } },
      {
        $set: {
          status: "failed",
          failureReason: String(reason || "").slice(0, 500),
        },
      },
      { session, new: true },
    );

    if (!withdrawal) {
      return;
    }

    const wallet = await OrganizerWallet.findOneAndUpdate(
      { organizerUserId: withdrawal.organizerUserId },
      {
        $inc: {
          reservedBalanceKobo: -withdrawal.amountKobo,
          availableBalanceKobo: withdrawal.amountKobo,
          version: 1,
        },
      },
      { session, new: true },
    );

    // No pre-check needed: the atomic claim above (status reserved/
    // processing -> failed) already guarantees a given withdrawal can be
    // reversed exactly once, so this idempotencyKey can never legitimately
    // collide.
    await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          organizerUserId: withdrawal.organizerUserId,
          type: "withdrawal_reversal",
          amountKobo: withdrawal.amountKobo,
          bucket: "available",
          status: "reversed",
          withdrawalId: withdrawal._id,
          idempotencyKey: `withdrawal_reversal:${withdrawal._id}`,
          description: `Withdrawal reversed: ${String(reason || "provider transfer failed").slice(0, 200)}`,
        },
      ],
      { session },
    );
  });

/**
 * Reserves the balance BEFORE calling Paystack (not after success) so a
 * second concurrent withdrawal request sees the already-reduced
 * availableBalanceKobo — the $gte filter below is what makes that race
 * safe, not application-level locking.
 */
const requestWithdrawal = async ({ organizerUserId, amountKobo }) => {
  const normalizedAmount = Math.max(1, Math.round(Number(amountKobo || 0)));

  if (normalizedAmount < env.walletMinWithdrawalKobo) {
    throw new ApiError(
      422,
      `Minimum withdrawal is ${env.walletMinWithdrawalKobo} kobo`,
    );
  }

  const payoutAccount = await PayoutAccount.findOne({ organizerUserId });

  if (!payoutAccount || payoutAccount.kycStatus !== "verified") {
    throw new ApiError(
      422,
      "Add and verify a payout account before withdrawing",
    );
  }

  const wallet = await getOrCreateWallet(organizerUserId);

  if (wallet.owingBalanceKobo > 0) {
    throw new ApiError(
      409,
      "An outstanding balance is owed to the platform — clear it before withdrawing",
    );
  }

  const withdrawal = await withMongoTransaction(async (session) => {
    const reservedWallet = await OrganizerWallet.findOneAndUpdate(
      { organizerUserId, availableBalanceKobo: { $gte: normalizedAmount } },
      {
        $inc: {
          availableBalanceKobo: -normalizedAmount,
          reservedBalanceKobo: normalizedAmount,
          version: 1,
        },
      },
      { session, new: true },
    );

    if (!reservedWallet) {
      throw new ApiError(409, "Insufficient available balance");
    }

    const [createdWithdrawal] = await Withdrawal.create(
      [
        {
          organizerUserId,
          payoutAccountId: payoutAccount._id,
          amountKobo: normalizedAmount,
          status: "reserved",
        },
      ],
      { session },
    );

    await WalletTransaction.create(
      [
        {
          walletId: reservedWallet._id,
          organizerUserId,
          type: "withdrawal",
          amountKobo: -normalizedAmount,
          bucket: "available",
          status: "completed",
          withdrawalId: createdWithdrawal._id,
          idempotencyKey: `withdrawal:${createdWithdrawal._id}`,
          description: "Withdrawal reserved from available balance",
        },
      ],
      { session },
    );

    return createdWithdrawal;
  });

  // Outside the DB transaction — the reservation above already committed,
  // so a failure here must actively reverse it rather than roll back.
  try {
    const transferReference = `vera_withdrawal_${withdrawal._id}_${Date.now()}`;
    const transfer = await initiatePaystackTransfer({
      amountKobo: normalizedAmount,
      recipientCode: payoutAccount.paystackRecipientCode,
      reference: transferReference,
      reason: "Vera wallet withdrawal",
    });

    withdrawal.status = "processing";
    withdrawal.paystackTransferCode = transfer?.transfer_code || "";
    withdrawal.paystackReference = transferReference;
    await withdrawal.save();
  } catch (error) {
    await reverseWithdrawal({
      withdrawalId: withdrawal._id,
      reason:
        error instanceof Error
          ? error.message
          : "Paystack transfer failed to initiate",
    });

    throw new ApiError(
      502,
      "Could not initiate the withdrawal transfer — your balance has been restored",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  return withdrawal;
};

/** Called from the Paystack webhook dispatcher on transfer.success. */
const finalizeWithdrawalSuccess = async ({ paystackReference }) => {
  await withMongoTransaction(async (session) => {
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { paystackReference, status: "processing" },
      { $set: { status: "completed" } },
      { session, new: true },
    );

    if (!withdrawal) {
      return;
    }

    await OrganizerWallet.updateOne(
      { organizerUserId: withdrawal.organizerUserId },
      {
        $inc: {
          reservedBalanceKobo: -withdrawal.amountKobo,
          lifetimeWithdrawnKobo: withdrawal.amountKobo,
          version: 1,
        },
      },
      { session },
    );
  });
};

/** Called from the Paystack webhook dispatcher on transfer.failed/reversed. */
const finalizeWithdrawalFailure = async ({ paystackReference, reason }) => {
  const withdrawal = await Withdrawal.findOne({ paystackReference });

  if (!withdrawal) {
    return;
  }

  await reverseWithdrawal({ withdrawalId: withdrawal._id, reason });
};

const listWithdrawals = async ({ organizerUserId, page = 1, limit = 20 }) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    Withdrawal.find({ organizerUserId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),
    Withdrawal.countDocuments({ organizerUserId }),
  ]);

  return {
    items,
    ...buildPaginationMeta({ page: pageNumber, limit: limitNumber, totalItems }),
  };
};

module.exports = {
  requestWithdrawal,
  reverseWithdrawal,
  finalizeWithdrawalSuccess,
  finalizeWithdrawalFailure,
  listWithdrawals,
};
