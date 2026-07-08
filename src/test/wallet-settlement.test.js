const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditTicketSale } = require("../services/wallet.service");
const { runSettlementTick } = require("../services/wallet-settlement.service");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("running settlement twice concurrently credits the wallet exactly once", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  // Force this ticket's sale into settlement-eligibility right now, instead
  // of waiting on the real 24h standard-tier delay.
  await WalletTransaction.updateMany(
    { ticketId: ticket._id },
    { $set: { settlementEligibleAt: new Date(Date.now() - 1000) } },
  );

  await Promise.all([runSettlementTick({}), runSettlementTick({})]);

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  const settlementTxnCount = await WalletTransaction.countDocuments({
    organizerUserId: organizer._id,
    type: "settlement",
  });

  expect(settlementTxnCount).toBe(1);
  expect(wallet.pendingBalanceKobo).toBe(0);
  expect(wallet.availableBalanceKobo).toBeGreaterThan(0);
});

test("a settled transaction is skipped on a later tick (idempotent re-run)", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));
  await WalletTransaction.updateMany(
    { ticketId: ticket._id },
    { $set: { settlementEligibleAt: new Date(Date.now() - 1000) } },
  );

  await runSettlementTick({});
  const walletAfterFirst = await OrganizerWallet.findOne({
    organizerUserId: organizer._id,
  });

  await runSettlementTick({});
  const walletAfterSecond = await OrganizerWallet.findOne({
    organizerUserId: organizer._id,
  });

  expect(walletAfterSecond.availableBalanceKobo).toBe(
    walletAfterFirst.availableBalanceKobo,
  );

  const settlementTxnCount = await WalletTransaction.countDocuments({
    organizerUserId: organizer._id,
    type: "settlement",
  });

  expect(settlementTxnCount).toBe(1);
});
