jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackRefund: jest.fn().mockResolvedValue({ status: "processed" }),
}));

const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditTicketSale } = require("../services/wallet.service");
const { runSettlementTick } = require("../services/wallet-settlement.service");
const { refundTicket } = require("../services/refund.service");
const { requestWithdrawal } = require("../services/withdrawal.service");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const PayoutAccount = require("../models/payout-account.model");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HIGH_TICKET_PRICE_NAIRA = 200000;

test("pre-settlement refund fully reverses the pending balance", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    baseUnitPriceNaira: HIGH_TICKET_PRICE_NAIRA,
  });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  const walletBefore = await OrganizerWallet.findOne({
    organizerUserId: organizer._id,
  });
  expect(walletBefore.pendingBalanceKobo).toBeGreaterThan(0);

  await refundTicket({
    ticketId: ticket._id,
    actorUserId: String(buyer._id),
    reason: "attendee requested",
  });

  const walletAfter = await OrganizerWallet.findOne({
    organizerUserId: organizer._id,
  });
  expect(walletAfter.pendingBalanceKobo).toBe(0);
  expect(walletAfter.availableBalanceKobo).toBe(0);

  const refreshedTicket = await EventTicket.findById(ticket._id);
  expect(refreshedTicket.status).toBe("refunded");
});

test(
  "post-settlement refund larger than available balance marks the organizer " +
    "as owing and blocks withdrawal",
  async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const event = await createEvent({ organizerUserId: organizer._id });
    const ticket = await createPaidTicket({
      event,
      buyerUserId: buyer._id,
      baseUnitPriceNaira: HIGH_TICKET_PRICE_NAIRA,
    });

    await withMongoTransaction((session) => creditTicketSale({ ticket, session }));
    await WalletTransaction.updateMany(
      { ticketId: ticket._id },
      { $set: { settlementEligibleAt: new Date(Date.now() - 1000) } },
    );
    await runSettlementTick({});

    // Simulate the organizer already having withdrawn most of the balance,
    // so the refund below exceeds what's left available.
    await OrganizerWallet.updateOne(
      { organizerUserId: organizer._id },
      { $set: { availableBalanceKobo: 5_000_000 } },
    );

    await refundTicket({
      ticketId: ticket._id,
      actorUserId: String(organizer._id),
      reason: "event misrepresented",
    });

    const walletAfter = await OrganizerWallet.findOne({
      organizerUserId: organizer._id,
    });
    expect(walletAfter.availableBalanceKobo).toBe(0);
    expect(walletAfter.owingBalanceKobo).toBeGreaterThan(0);

    await PayoutAccount.create({
      organizerUserId: organizer._id,
      bankCode: "058",
      bankName: "Test Bank",
      accountNumber: "0123456789",
      accountName: "Test Organizer",
      paystackRecipientCode: "RCP_test",
      kycStatus: "verified",
    });

    await expect(
      requestWithdrawal({ organizerUserId: organizer._id, amountKobo: 1_000_000 }),
    ).rejects.toThrow(/owed to the platform/);
  },
);
