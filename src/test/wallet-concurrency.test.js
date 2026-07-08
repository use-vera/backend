const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditTicketSale } = require("../services/wallet.service");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("N concurrent ticket purchases for the same organizer never lose a wallet update", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const TICKET_COUNT = 8;
  const tickets = await Promise.all(
    Array.from({ length: TICKET_COUNT }, () =>
      createPaidTicket({ event, buyerUserId: buyer._id, baseUnitPriceNaira: 5000 }),
    ),
  );

  await Promise.all(
    tickets.map((ticket) =>
      withMongoTransaction((session) => creditTicketSale({ ticket, session })),
    ),
  );

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  const saleTransactions = await WalletTransaction.find({
    organizerUserId: organizer._id,
    type: "ticket_sale",
  });

  const expectedTotalKobo = saleTransactions.reduce(
    (sum, transaction) => sum + transaction.amountKobo,
    0,
  );

  expect(saleTransactions).toHaveLength(TICKET_COUNT);
  expect(expectedTotalKobo).toBeGreaterThan(0);
  expect(wallet.pendingBalanceKobo).toBe(expectedTotalKobo);
});

test("crediting the same ticket twice (verify + webhook race) only credits once", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await Promise.all([
    withMongoTransaction((session) => creditTicketSale({ ticket, session })),
    withMongoTransaction((session) => creditTicketSale({ ticket, session })),
  ]);

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  const saleTransactions = await WalletTransaction.find({
    ticketId: ticket._id,
    type: "ticket_sale",
  });

  expect(saleTransactions).toHaveLength(1);
  expect(wallet.pendingBalanceKobo).toBe(saleTransactions[0].amountKobo);
});
