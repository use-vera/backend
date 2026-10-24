/* What a refund does when Paystack says something other than "done": a
   payment it never saw, a payment it already reversed, or a plain refusal. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_outcomes";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackRefund: jest.fn(),
  verifyPaystackTransaction: jest.fn(),
}));

const ApiError = require("../utils/api-error");
const env = require("../config/env");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { refundTicket } = require("../services/refund.service");
const { sweepEventTickets } = require("../services/event-cancellation-refund-monitor.service");
const { initiatePaystackRefund, verifyPaystackTransaction } = require("../services/paystack.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const paystackError = (code, message) =>
  new ApiError(502, "Paystack request failed", { statusCode: 400, payload: { status: false, code, message } });

const cancelledEventWithTicket = async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  await Event.updateOne({ _id: event._id }, { $set: { status: "cancelled", cancelledAt: new Date() } });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  return { organizer, event, ticket };
};

beforeEach(() => {
  initiatePaystackRefund.mockReset();
  verifyPaystackTransaction.mockReset();
});

afterEach(() => {
  env.paystackSecretKey = "sk_test_refund_outcomes";
});

test("in test mode, a payment Paystack never saw is closed without a provider refund", async () => {
  const { organizer, ticket } = await cancelledEventWithTicket();
  initiatePaystackRefund.mockRejectedValueOnce(paystackError("transaction_not_found", "Transaction not found"));

  await refundTicket({ ticketId: ticket._id, actorUserId: organizer._id });

  const saved = await EventTicket.findById(ticket._id);
  expect(saved.status).toBe("refunded");
  expect(saved.refundMethod).toBe("none");
});

test("in live mode, a payment Paystack cannot find is flagged, not marked refunded", async () => {
  env.paystackSecretKey = "sk_live_refund_outcomes";
  const { organizer, ticket } = await cancelledEventWithTicket();
  initiatePaystackRefund.mockRejectedValueOnce(paystackError("transaction_not_found", "Transaction not found"));

  await expect(refundTicket({ ticketId: ticket._id, actorUserId: organizer._id })).rejects.toMatchObject({
    code: "PAYMENT_NOT_FOUND_AT_PROVIDER",
  });

  const saved = await EventTicket.findById(ticket._id);
  expect(saved.status).toBe("paid");
  expect(saved.refundAttention.code).toBe("PAYMENT_NOT_FOUND_AT_PROVIDER");
});

test("the cancellation sweep stops retrying a flagged ticket", async () => {
  env.paystackSecretKey = "sk_live_refund_outcomes";
  const { event, ticket } = await cancelledEventWithTicket();
  initiatePaystackRefund.mockRejectedValue(paystackError("transaction_not_found", "Transaction not found"));

  await sweepEventTickets(await Event.findById(event._id));
  await sweepEventTickets(await Event.findById(event._id));

  expect(initiatePaystackRefund).toHaveBeenCalledTimes(1);
  expect((await EventTicket.findById(ticket._id)).status).toBe("paid");
});

test("a payment Paystack already reversed counts as refunded", async () => {
  const { organizer, ticket } = await cancelledEventWithTicket();
  initiatePaystackRefund.mockRejectedValueOnce(paystackError("transaction_fully_refunded", "Transaction has been fully reversed"));
  verifyPaystackTransaction.mockResolvedValueOnce({ status: "reversed" });

  await refundTicket({ ticketId: ticket._id, actorUserId: organizer._id });

  const saved = await EventTicket.findById(ticket._id);
  expect(saved.status).toBe("refunded");
  expect(saved.refundMethod).toBe("paystack");
});

test("any other refusal leaves the ticket paid, retryable, with Paystack's reason", async () => {
  const { organizer, ticket } = await cancelledEventWithTicket();
  initiatePaystackRefund.mockRejectedValueOnce(paystackError("insufficient_balance", "Insufficient balance"));
  verifyPaystackTransaction.mockResolvedValueOnce({ status: "success" });

  await expect(refundTicket({ ticketId: ticket._id, actorUserId: organizer._id })).rejects.toMatchObject({
    code: "PAYSTACK_REFUND_FAILED",
    message: expect.stringContaining("Insufficient balance"),
  });

  const saved = await EventTicket.findById(ticket._id);
  expect(saved.status).toBe("paid");
  expect(saved.refundAttention?.at ?? null).toBeNull();
});

test("a free ticket on a cancelled event closes without calling Paystack", async () => {
  const { organizer, event } = await cancelledEventWithTicket();
  const free = await EventTicket.create({
    eventId: event._id,
    organizerUserId: organizer._id,
    buyerUserId: (await createUser())._id,
    quantity: 1,
    unitPriceNaira: 0,
    totalPriceNaira: 0,
    status: "paid",
    paymentProvider: "none",
    paymentReference: null,
    attendeeName: "Free Guest",
    attendeeEmail: "free@example.com",
    ticketCode: `VRA-FREE-${Date.now()}`,
    barcodeValue: `free_${Date.now()}`,
  });

  await refundTicket({ ticketId: free._id, actorUserId: organizer._id });

  expect(initiatePaystackRefund).not.toHaveBeenCalled();
  expect((await EventTicket.findById(free._id)).refundMethod).toBe("none");
});
