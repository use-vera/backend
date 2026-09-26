/* A cancelled event owes money in three directions: the ticket, the add-ons
   bought with it, and everything the vendors took. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_cancel";
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

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  dispatchEmail: jest.fn().mockResolvedValue(null),
}));

const eventVendorService = require("../services/event-vendor.service");
const vendorOrderService = require("../services/vendor-order.service");
const vendorService = require("../services/vendor.service");
const { refundStallFee } = require("../services/refund.service");
const {
  runEventCancellationRefundMonitorTick,
} = require("../services/event-cancellation-refund-monitor.service");
const {
  initiatePaystackRefund,
  verifyPaystackTransaction,
} = require("../services/paystack.service");
const Event = require("../models/event.model");
const EventVendor = require("../models/event-vendor.model");
const VendorOrder = require("../models/vendor-order.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/** A live event with a paid-up vendor and one order waiting to be collected. */
const eventWithVendor = async ({ stallFeeNaira = 25000 } = {}) => {
  const organizer = await createUser();
  const vendorOwner = await createUser();
  const buyer = await createUser();

  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() - HOUR_MS),
    endsAt: new Date(Date.now() + 6 * HOUR_MS),
    vendorSettings: { acceptingApplications: true, stallFeeNaira, spots: 0 },
  });

  const vendor = await vendorService.createVendor({
    actorUserId: vendorOwner._id,
    payload: { businessName: "Mama Put Express", categories: ["food"] },
  });

  const invite = await eventVendorService.inviteVendor({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { vendorId: vendor._id },
  });

  const answered = await eventVendorService.respondToInvite({
    bookingId: invite._id,
    actorUserId: vendorOwner._id,
    accept: true,
  });

  if (answered.requiresPayment) {
    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: stallFeeNaira * 100,
    });

    await eventVendorService.verifyStallFee({
      bookingId: invite._id,
      actorUserId: vendorOwner._id,
      reference: answered.payment.reference,
    });
  }

  const item = await vendorService.createItem({
    actorUserId: vendorOwner._id,
    payload: { name: "Jollof", category: "food", priceNaira: 4000 },
  });

  await createPaidTicket({ event, buyerUserId: buyer._id });

  const placed = await vendorOrderService.placeOrder({
    eventId: event._id,
    vendorId: vendor._id,
    actorUserId: buyer._id,
    payload: { items: [{ itemId: item._id, quantity: 1 }] },
  });

  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: placed.order.pricing.totalChargedNaira * 100,
  });
  await vendorOrderService.verifyOrderPayment({
    orderId: placed.order._id,
    actorUserId: buyer._id,
    reference: placed.payment.reference,
  });

  return { organizer, vendorOwner, vendor, buyer, event, invite, placed };
};

beforeEach(() => {
  initiatePaystackRefund.mockClear();
  verifyPaystackTransaction.mockReset();
});

test("a stall fee comes back out of the organizer's wallet", async () => {
  const { organizer, invite } = await eventWithVendor();

  const before = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(before.pendingBalanceKobo).toBe(25000 * 100);

  const result = await refundStallFee({
    bookingId: invite._id,
    reason: "Event cancelled",
  });

  expect(result.amountNaira).toBe(25000);
  expect(initiatePaystackRefund).toHaveBeenCalledWith(
    expect.objectContaining({ amountKobo: 25000 * 100 }),
  );

  const after = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(after.pendingBalanceKobo).toBe(0);
  expect(after.lifetimeRefundedKobo).toBe(25000 * 100);

  const reversal = await WalletTransaction.findOne({
    idempotencyKey: `refund:stall_fee:${invite._id}`,
  });
  expect(reversal.amountKobo).toBe(-25000 * 100);
});

test("refunding a stall fee twice only moves the money once", async () => {
  const { organizer, invite } = await eventWithVendor();

  await refundStallFee({ bookingId: invite._id, reason: "Event cancelled" });
  const second = await refundStallFee({
    bookingId: invite._id,
    reason: "Event cancelled",
  });

  expect(second).toBeNull();

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(wallet.lifetimeRefundedKobo).toBe(25000 * 100);
});

test("cancelling an event refunds the orders, the stall fee, and closes the booking", async () => {
  const { event, invite, placed, organizer } = await eventWithVendor();

  await Event.updateOne(
    { _id: event._id },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: "Venue flooded",
      },
    },
  );

  await runEventCancellationRefundMonitorTick();

  /* The buyer gets their food money back... */
  const order = await VendorOrder.findById(placed.order._id);
  expect(order.status).toBe("refunded");

  /* ...the vendor gets their spot money back... */
  const booking = await EventVendor.findById(invite._id);
  expect(booking.stallFeePaid).toBe(false);
  expect(booking.stallFeeRefundedAt).toBeTruthy();

  /* ...and nobody is still booked to turn up. */
  expect(booking.status).toBe("cancelled");

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  expect(wallet.lifetimeRefundedKobo).toBeGreaterThanOrEqual(25000 * 100);
});

test("a collected order is not refunded: that food was eaten", async () => {
  const { event, placed, vendorOwner } = await eventWithVendor({
    stallFeeNaira: 0,
  });

  await vendorOrderService.collectOrder({
    orderId: placed.order._id,
    actorUserId: vendorOwner._id,
    code: placed.order.pickupCode,
  });

  await Event.updateOne(
    { _id: event._id },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
  );

  await runEventCancellationRefundMonitorTick();

  const order = await VendorOrder.findById(placed.order._id);
  expect(order.status).toBe("collected");
});
