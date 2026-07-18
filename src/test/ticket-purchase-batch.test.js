jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn().mockResolvedValue({
    status: "success",
    amount: 15000 * 100,
  }),
}));

const {
  initializeTicketPurchase,
  verifyTicketPayment,
  listMyTickets,
} = require("../services/event.service");
const { createUser, createEvent } = require("./fixtures");

const futureWindow = () => ({
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 27 * 60 * 60 * 1000),
});

test("buying multiple tickets in one purchase issues one distinct code per ticket, all discoverable via purchaseBatchId", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    isPaid: false,
    ticketPriceNaira: 0,
    ...futureWindow(),
  });

  const result = await initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { quantity: 3 },
  });

  expect(result.requiresPayment).toBe(false);
  expect(result.ticketIds).toHaveLength(3);
  expect(result.purchaseBatchId).toBeTruthy();

  const batch = await listMyTickets({
    actorUserId: buyer._id,
    purchaseBatchId: result.purchaseBatchId,
  });

  expect(batch.items).toHaveLength(3);
  const codes = batch.items.map((item) => item.ticketCode);
  expect(new Set(codes).size).toBe(3);
  codes.forEach((code) => expect(code).toBeTruthy());
});

test("a purchaseBatchId filter only ever returns the calling buyer's own tickets", async () => {
  const organizer = await createUser();
  const buyerOne = await createUser();
  const buyerTwo = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    isPaid: false,
    ticketPriceNaira: 0,
    ...futureWindow(),
  });

  const result = await initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyerOne._id,
    payload: { quantity: 2 },
  });

  const otherBuyerView = await listMyTickets({
    actorUserId: buyerTwo._id,
    purchaseBatchId: result.purchaseBatchId,
  });

  expect(otherBuyerView.items).toHaveLength(0);
});

test("verifying a paid multi-quantity purchase returns purchaseBatchId so every ticket in the batch can be fetched", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    isPaid: true,
    ticketPriceNaira: 5000,
    ...futureWindow(),
  });

  const initResult = await initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { quantity: 3, callbackUrl: "https://example.com/callback" },
  });

  expect(initResult.requiresPayment).toBe(true);
  expect(initResult.ticketIds).toHaveLength(3);

  const verifyResult = await verifyTicketPayment({
    ticketId: initResult.ticket._id,
    actorUserId: buyer._id,
    reference: "mock_reference",
  });

  expect(verifyResult.purchaseBatchId).toBe(initResult.purchaseBatchId);

  const batch = await listMyTickets({
    actorUserId: buyer._id,
    purchaseBatchId: verifyResult.purchaseBatchId,
  });

  expect(batch.items).toHaveLength(3);
  expect(batch.items.every((item) => item.status === "paid")).toBe(true);
});
