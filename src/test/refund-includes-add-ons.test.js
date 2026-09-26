/* Every way of refunding a ticket must also give back what was bought with
   it. Two of the three paths used to forget. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_addons";
process.env.PAYSTACK_DEV_BYPASS = "false";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
  initiatePaystackRefund: jest
    .fn()
    .mockResolvedValue({ transaction: { reference: "refund_ref" } }),
}));

const mongoose = require("mongoose");
const {
  initializeTicketPurchase,
  verifyTicketPayment,
} = require("../services/event.service");
const { refundTicket } = require("../services/refund.service");
const {
  refundTicketForWorkspace,
} = require("../services/v1-refund.service");
const { verifyPaystackTransaction } = require("../services/paystack.service");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/** A paid ticket with a ₦5,000 add-on on it. */
const ticketWithAddOn = async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = {
    _id: new mongoose.Types.ObjectId(),
    name: "Parking",
    priceNaira: 5000,
    redemption: "door",
    stock: 10,
    variants: [],
    maxPerTicket: 2,
    transfersOnResale: true,
    active: true,
  };

  const event = await createEvent({
    organizerUserId: organizer._id,
    isPaid: true,
    ticketPriceNaira: 10000,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 54 * HOUR_MS),
    addOns: [parking],
  });

  const placed = await initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: {
      quantity: 1,
      email: "buyer@example.com",
      addOns: [{ addOnId: String(parking._id), quantity: 1 }],
    },
  });

  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: placed.pricingBreakdown.totalCheckoutNaira * 100,
  });
  await verifyTicketPayment({
    ticketId: placed.ticket._id,
    actorUserId: buyer._id,
    reference: placed.payment.reference,
  });

  return { organizer, buyer, event, ticketId: placed.ticket._id };
};

const addOnStatus = async (ticketId) => {
  const row = await EventAddOnPurchase.findOne({ ticketId });

  return row.status;
};

test("an organizer refunding by hand gives back the add-ons too", async () => {
  const { organizer, ticketId } = await ticketWithAddOn();

  expect(await addOnStatus(ticketId)).toBe("paid");

  await refundTicket({
    ticketId,
    actorUserId: organizer._id,
    reason: "Changed their mind",
  });

  expect(await addOnStatus(ticketId)).toBe("refunded");
});

test("the v1 API refund gives back the add-ons too", async () => {
  const { event, ticketId } = await ticketWithAddOn();

  await refundTicketForWorkspace({
    workspaceId: event.workspaceId,
    ticketId,
    reason: "Partner refund",
  });

  expect(await addOnStatus(ticketId)).toBe("refunded");
});
