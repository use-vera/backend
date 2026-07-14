const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const {
  creditTicketSale,
  listWalletTransactions,
  getWalletTransactionById,
} = require("../services/wallet.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("listWalletTransactions populates the event name on ticket_sale and platform_fee lines", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "API Developer Conference",
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  const result = await listWalletTransactions({ organizerUserId: organizer._id });
  const saleLine = result.items.find((item) => item.type === "ticket_sale");
  const feeLine = result.items.find((item) => item.type === "platform_fee");

  expect(saleLine.eventId.name).toBe("API Developer Conference");
  expect(feeLine.eventId.name).toBe("API Developer Conference");
  expect(saleLine.ticketId.ticketCode).toBe(ticket.ticketCode);
});

test("getWalletTransactionById returns the transaction with a populated event for its owner", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "API Developer Conference",
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  const result = await listWalletTransactions({ organizerUserId: organizer._id });
  const saleLine = result.items.find((item) => item.type === "ticket_sale");

  const detail = await getWalletTransactionById({
    transactionId: saleLine._id,
    organizerUserId: organizer._id,
  });

  expect(detail.eventId.name).toBe("API Developer Conference");
  expect(detail.ticketId.ticketCode).toBe(ticket.ticketCode);
});

test("getWalletTransactionById rejects a caller who does not own the transaction", async () => {
  const organizer = await createUser();
  const stranger = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  const result = await listWalletTransactions({ organizerUserId: organizer._id });
  const saleLine = result.items.find((item) => item.type === "ticket_sale");

  await expect(
    getWalletTransactionById({
      transactionId: saleLine._id,
      organizerUserId: stranger._id,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("getWalletTransactionById 404s for a transaction that doesn't exist", async () => {
  const organizer = await createUser();

  await expect(
    getWalletTransactionById({
      transactionId: "64b6f0f0f0f0f0f0f0f0f0f0",
      organizerUserId: organizer._id,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
});
