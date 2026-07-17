jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackRefund: jest.fn().mockResolvedValue({ status: "processed" }),
}));

const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditTicketSale } = require("../services/wallet.service");
const { cancelEvent } = require("../services/event.service");
const {
  runEventCancellationRefundMonitorTick,
} = require("../services/event-cancellation-refund-monitor.service");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const AppNotification = require("../models/notification.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("the monitor refunds a cancelled event's active tickets and marks the sweep complete", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id, baseUnitPriceNaira: 5000 });
  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id, reason: "Venue unavailable" });

  await runEventCancellationRefundMonitorTick();

  const refreshedTicket = await EventTicket.findById(ticket._id);
  expect(refreshedTicket.status).toBe("refunded");

  const refreshedEvent = await Event.findById(event._id);
  expect(refreshedEvent.refundSweepCompletedAt).toBeTruthy();

  const refundNotification = await AppNotification.findOne({
    type: "ticket.refunded",
    userId: buyer._id,
  });
  expect(refundNotification).toBeTruthy();
});

test("tickets that aren't paid/used (already refunded, pending, cancelled) are left untouched", async () => {
  const organizer = await createUser();
  const paidBuyer = await createUser();
  const pendingBuyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const paidTicket = await createPaidTicket({ event, buyerUserId: paidBuyer._id });
  await withMongoTransaction((session) => creditTicketSale({ ticket: paidTicket, session }));

  const pendingTicket = await createPaidTicket({
    event,
    buyerUserId: pendingBuyer._id,
    status: "pending",
  });

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id });
  await runEventCancellationRefundMonitorTick();

  const refreshedPaid = await EventTicket.findById(paidTicket._id);
  expect(refreshedPaid.status).toBe("refunded");

  const refreshedPending = await EventTicket.findById(pendingTicket._id);
  expect(refreshedPending.status).toBe("pending");
});

test("an event with no active tickets is swept immediately with nothing to refund", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id });
  await runEventCancellationRefundMonitorTick();

  const refreshedEvent = await Event.findById(event._id);
  expect(refreshedEvent.refundSweepCompletedAt).toBeTruthy();
});

test("a non-cancelled event's tickets are never touched by the monitor", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await withMongoTransaction((session) => creditTicketSale({ ticket, session }));

  await runEventCancellationRefundMonitorTick();

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("paid");
});
