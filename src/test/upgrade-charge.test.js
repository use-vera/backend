/* The upgrade sheet's "Pay ₦X" must be exactly what the checkout charges,
   including Vera's fee when the event passes it to attendees. */

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "sk_test_upgrade";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
}));

const mongoose = require("mongoose");
const { listTicketUpgradeOptions, initializeTicketUpgrade } = require("../services/event.service");
const PaymentAttempt = require("../models/payment-attempt.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const setup = async (feeMode) => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = { _id: new mongoose.Types.ObjectId(), name: "Regular", priceNaira: 10000, quantity: 50 };
  const vip = { _id: new mongoose.Types.ObjectId(), name: "VIP", priceNaira: 30000, quantity: 10 };
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 72 * HOUR_MS),
    endsAt: new Date(Date.now() + 78 * HOUR_MS),
    ticketCategories: [regular, vip],
    feeMode,
    platformFeePercent: 5,
  });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    baseUnitPriceNaira: 10000,
    feeMode,
    ticketCategoryId: regular._id,
    ticketCategoryName: regular.name,
  });
  return { buyer, ticket, vip };
};

test.each(["passed_to_attendee", "absorbed_by_organizer"])(
  "the shown upgrade total is what gets charged (%s)",
  async (feeMode) => {
    const { buyer, ticket, vip } = await setup(feeMode);

    const { options } = await listTicketUpgradeOptions({ ticketId: ticket._id, actorUserId: buyer._id });
    const option = options.find((item) => item._id === String(vip._id));
    const result = await initializeTicketUpgrade({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      payload: { ticketCategoryId: String(vip._id) },
    });
    const attempt = await PaymentAttempt.findById(result.paymentAttemptId);

    expect(option.upgradable).toBe(true);
    expect(attempt.amountKobo).toBe(option.checkoutNaira * 100);
    expect(option.checkoutNaira).toBe(option.differenceNaira + option.serviceFeeNaira);
    if (feeMode === "passed_to_attendee") {
      expect(option.serviceFeeNaira).toBeGreaterThan(0);
    } else {
      expect(option.serviceFeeNaira).toBe(0);
    }
  },
);
