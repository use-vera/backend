const ApiError = require("../utils/api-error");
const PayoutAccount = require("../models/payout-account.model");
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
  cachedBanks = banks.map((bank) => ({ name: bank.name, code: bank.code }));

  return cachedBanks;
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

module.exports = {
  listNigerianBanks,
  upsertPayoutAccount,
  getPayoutAccount,
};
