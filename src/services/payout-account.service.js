const ApiError = require("../utils/api-error");
const PayoutAccount = require("../models/payout-account.model");
const Withdrawal = require("../models/withdrawal.model");
const {
  listBanks,
  resolveBankAccount,
  createTransferRecipient,
} = require("./paystack.service");

// Bank lists change essentially never — cache for the process lifetime
// instead of hitting Paystack on every payout-setup screen open.
let cachedBanks = null;

const listNigerianBanks = async () => {
  if (cachedBanks) {
    return cachedBanks;
  }

  const banks = await listBanks();

  // Paystack's /bank list mixes NUBAN entries with mobile-money/USSD
  // channels that resolveBankAccount/createTransferRecipient (both hardcode
  // type: "nuban") can't actually resolve or pay out to, and sometimes
  // repeats the same bank code across channel types — both of which broke
  // the picker (unresolvable accounts, and duplicate React keys). Restrict
  // to NUBAN and de-dupe by code so every listed bank is both unique and
  // actually usable.
  const nubanBanks = banks.filter(
    (bank) => !bank.type || bank.type === "nuban",
  );
  const seenCodes = new Set();
  cachedBanks = [];

  for (const bank of nubanBanks) {
    if (seenCodes.has(bank.code)) {
      continue;
    }

    seenCodes.add(bank.code);
    cachedBanks.push({ name: bank.name, code: bank.code });
  }

  return cachedBanks;
};

/**
 * Resolve-only, no save — lets the client show the account holder's real
 * name back to the user for confirmation before anything is persisted.
 */
const previewPayoutAccount = async ({ bankCode, accountNumber }) => {
  const resolved = await resolveBankAccount({ accountNumber, bankCode });

  if (!resolved?.account_name) {
    throw new ApiError(422, "Could not verify this bank account");
  }

  return {
    accountName: resolved.account_name,
    bankName: resolved.bank_name || "",
  };
};

/**
 * Paystack's account-resolve call already confirms the account number
 * belongs to a real bank account with that name — treated as sufficient
 * verification for this pass (no separate KYC document upload step).
 */
const upsertPayoutAccount = async ({ organizerUserId, bankCode, accountNumber }) => {
  const resolved = await resolveBankAccount({ accountNumber, bankCode });

  if (!resolved?.account_name) {
    throw new ApiError(422, "Could not verify this bank account");
  }

  const recipient = await createTransferRecipient({
    name: resolved.account_name,
    accountNumber,
    bankCode,
  });

  const payoutAccount = await PayoutAccount.findOneAndUpdate(
    { organizerUserId },
    {
      $set: {
        bankCode,
        bankName: resolved.bank_name || "",
        accountNumber,
        accountName: resolved.account_name,
        paystackRecipientCode: recipient?.recipient_code || "",
        kycStatus: "verified",
        verifiedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return payoutAccount;
};

const getPayoutAccount = async (organizerUserId) =>
  PayoutAccount.findOne({ organizerUserId });

const deletePayoutAccount = async ({ organizerUserId }) => {
  const payoutAccount = await PayoutAccount.findOne({ organizerUserId });

  if (!payoutAccount) {
    return { deleted: false };
  }

  const hasActiveWithdrawal = await Withdrawal.exists({
    payoutAccountId: payoutAccount._id,
    status: { $in: ["reserved", "processing"] },
  });

  if (hasActiveWithdrawal) {
    throw new ApiError(
      409,
      "You have a withdrawal in progress on this account — wait for it to finish before removing it",
    );
  }

  await PayoutAccount.deleteOne({ _id: payoutAccount._id });

  return { deleted: true };
};

module.exports = {
  listNigerianBanks,
  previewPayoutAccount,
  upsertPayoutAccount,
  getPayoutAccount,
  deletePayoutAccount,
};
