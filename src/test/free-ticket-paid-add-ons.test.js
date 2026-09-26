/* A free ticket with paid add-ons was handed over without a payment: every
   branch in initializeTicketPurchase asked "is the EVENT paid?" instead of
   "does this BASKET cost anything?", so the add-ons were issued for ₦0 and
   the organizer was credited for money nobody ever sent. */

/* Pinned rather than inherited from .env: whether this order needs paying for
   must not depend on whether the machine running the tests has a Paystack key. */
process.env.PAYSTACK_SECRET_KEY = "sk_test_free_ticket_paid_add_ons";
process.env.PAYSTACK_DEV_BYPASS = "false";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn().mockResolvedValue({
    status: "success",
    amount: 0,
  }),
}));

const mongoose = require("mongoose");
const {
  initializeTicketPurchase,
  verifyTicketPayment,
} = require("../services/event.service");
const { verifyPaystackTransaction } = require("../services/paystack.service");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const freeEvent = (organizerUserId, addOns) =>
  createEvent({
    organizerUserId,
    isPaid: false,
    ticketPriceNaira: 0,
    platformFeePercent: 5,
    feeMode: "absorbed_by_organizer",
    expectedTickets: 100,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 54 * HOUR_MS),
    addOns,
  });

const parkingAddOn = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: "Parking",
  priceNaira: 5000,
  redemption: "door",
  stock: 10,
  variants: [],
  maxPerTicket: 2,
  transfersOnResale: true,
  active: true,
  ...overrides,
});

const buy = ({ event, buyer, addOns = [] }) =>
  initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { quantity: 1, email: "buyer@example.com", addOns },
  });

test("a free ticket with a paid add-on has to be paid for before either is issued", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = parkingAddOn();
  const event = await freeEvent(organizer._id, [parking]);

  const result = await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(parking._id), quantity: 1 }],
  });

  expect(result.requiresPayment).toBe(true);
  expect(result.payment?.authorizationUrl).toBeTruthy();
  expect(result.pricingBreakdown.totalCheckoutNaira).toBe(5000);

  // Nothing is usable until the money lands.
  const ticket = await EventTicket.findById(result.ticket._id);
  expect(ticket.status).toBe("pending");

  const held = await EventAddOnPurchase.find({ ticketId: result.ticket._id });
  expect(held).toHaveLength(1);
  expect(held[0].status).toBe("pending");

  // And the organizer is not credited for money that has not arrived.
  const credits = await WalletTransaction.find({
    organizerUserId: organizer._id,
    type: { $in: ["ticket_sale", "add_on_sale"] },
  });
  expect(credits).toHaveLength(0);
});

test("paying for that order issues the free ticket and its add-on together", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = parkingAddOn();
  const event = await freeEvent(organizer._id, [parking]);

  const result = await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(parking._id), quantity: 2 }],
  });

  expect(result.pricingBreakdown.totalCheckoutNaira).toBe(10000);

  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: 10000 * 100,
  });

  await verifyTicketPayment({
    ticketId: result.ticket._id,
    actorUserId: buyer._id,
    reference: result.payment?.reference || "mock_reference",
  });

  const ticket = await EventTicket.findById(result.ticket._id);
  expect(ticket.status).toBe("paid");

  const held = await EventAddOnPurchase.find({ ticketId: result.ticket._id });
  expect(held.every((row) => row.status === "paid")).toBe(true);

  /* The ticket was free, so the organizer's credit is add-on money only:
     ₦10,000 less Vera's 5%. */
  const credited = await WalletTransaction.find({
    organizerUserId: organizer._id,
    type: { $in: ["ticket_sale", "add_on_sale"] },
  });
  const totalKobo = credited.reduce(
    (sum, row) => sum + Number(row.amountKobo || 0),
    0,
  );
  expect(totalKobo).toBe(9500 * 100);
});

test("a free ticket with no add-ons is still issued on the spot", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await freeEvent(organizer._id, []);

  const result = await buy({ event, buyer });

  expect(result.requiresPayment).toBe(false);
  expect(result.payment).toBeNull();

  const ticket = await EventTicket.findById(result.ticket._id);
  expect(ticket.status).toBe("paid");
});

test("a free add-on on a free event is still issued on the spot", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const lanyard = parkingAddOn({ name: "Lanyard", priceNaira: 0 });
  const event = await freeEvent(organizer._id, [lanyard]);

  const result = await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(lanyard._id), quantity: 1 }],
  });

  expect(result.requiresPayment).toBe(false);

  const held = await EventAddOnPurchase.find({ ticketId: result.ticket._id });
  expect(held).toHaveLength(1);
  expect(held[0].status).toBe("paid");
});
