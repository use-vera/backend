jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackTransfer: jest.fn(),
}));

const { initiatePaystackTransfer } = require("../services/paystack.service");
const { requestWithdrawal } = require("../services/withdrawal.service");
const OrganizerWallet = require("../models/organizer-wallet.model");
const PayoutAccount = require("../models/payout-account.model");
const Withdrawal = require("../models/withdrawal.model");
const { createUser } = require("./fixtures");

const createVerifiedPayoutAccount = (organizerUserId) =>
  PayoutAccount.create({
    organizerUserId,
    bankCode: "058",
    bankName: "Test Bank",
    accountNumber: "0123456789",
    accountName: "Test Organizer",
    paystackRecipientCode: "RCP_test",
    kycStatus: "verified",
  });

beforeEach(() => {
  initiatePaystackTransfer.mockReset();
});

test("two concurrent withdrawal requests for the full balance: exactly one succeeds", async () => {
  initiatePaystackTransfer.mockResolvedValue({ transfer_code: "TRF_test" });

  const organizer = await createUser();
  await OrganizerWallet.create({
    organizerUserId: organizer._id,
    availableBalanceKobo: 10_000_000,
  });
  await createVerifiedPayoutAccount(organizer._id);

  const results = await Promise.allSettled([
    requestWithdrawal({ organizerUserId: organizer._id, amountKobo: 10_000_000 }),
    requestWithdrawal({ organizerUserId: organizer._id, amountKobo: 10_000_000 }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(String(rejected[0].reason.message)).toMatch(/Insufficient available balance/);

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(wallet.availableBalanceKobo).toBe(0);
  expect(wallet.reservedBalanceKobo).toBe(10_000_000);
});

test("a failed transfer reverses the reservation and marks the withdrawal failed", async () => {
  initiatePaystackTransfer.mockRejectedValueOnce(new Error("provider down"));

  const organizer = await createUser();
  await OrganizerWallet.create({
    organizerUserId: organizer._id,
    availableBalanceKobo: 5_000_000,
  });
  await createVerifiedPayoutAccount(organizer._id);

  await expect(
    requestWithdrawal({ organizerUserId: organizer._id, amountKobo: 5_000_000 }),
  ).rejects.toThrow(/balance has been restored/);

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(wallet.availableBalanceKobo).toBe(5_000_000);
  expect(wallet.reservedBalanceKobo).toBe(0);

  const withdrawal = await Withdrawal.findOne({ organizerUserId: organizer._id });
  expect(withdrawal.status).toBe("failed");
});
