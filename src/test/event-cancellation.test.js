const { cancelEvent } = require("../services/event.service");
const EventTicket = require("../models/event-ticket.model");
const AppNotification = require("../models/notification.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("cancelling an event sets status/cancelledAt/cancellationReason and returns affected ticket totals", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  await createPaidTicket({ event, buyerUserId: buyer._id, baseUnitPriceNaira: 5000 });

  const result = await cancelEvent({
    eventId: event._id,
    actorUserId: organizer._id,
    reason: "Venue unavailable",
  });

  expect(result.event.status).toBe("cancelled");
  expect(result.event.cancelledAt).toBeTruthy();
  expect(result.event.cancellationReason).toBe("Venue unavailable");
  expect(result.affectedTicketCount).toBe(1);
  expect(result.totalRefundNaira).toBeGreaterThan(0);
});

test("cancelling does not refund inline — ticket status is unchanged immediately after", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id });

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("paid");
});

test("cancelling notifies the organizer and every distinct paid/used ticket holder", async () => {
  const organizer = await createUser();
  const buyerOne = await createUser();
  const buyerTwo = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  await createPaidTicket({ event, buyerUserId: buyerOne._id });
  await createPaidTicket({ event, buyerUserId: buyerTwo._id });
  // A second ticket for the same buyer should not produce a duplicate notification.
  await createPaidTicket({ event, buyerUserId: buyerOne._id });

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id, reason: "" });

  const attendeeNotifications = await AppNotification.find({
    type: "event.cancelled",
  });
  expect(attendeeNotifications).toHaveLength(2);
  const recipientIds = attendeeNotifications.map((item) => String(item.userId)).sort();
  expect(recipientIds).toEqual(
    [String(buyerOne._id), String(buyerTwo._id)].sort(),
  );

  const organizerNotifications = await AppNotification.find({
    type: "event.cancelled.confirmation",
    userId: organizer._id,
  });
  expect(organizerNotifications).toHaveLength(1);
  // 3 tickets total (2 for buyerOne, 1 for buyerTwo) — the organizer's
  // count reflects tickets being refunded, not unique buyers.
  expect(organizerNotifications[0].message).toContain("3 attendee(s)");
});

test("a reason is included in the attendee notification message", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id, name: "Test Gala" });
  await createPaidTicket({ event, buyerUserId: buyer._id });

  await cancelEvent({
    eventId: event._id,
    actorUserId: organizer._id,
    reason: "Double-booked venue",
  });

  const notification = await AppNotification.findOne({ type: "event.cancelled" });
  expect(notification.message).toContain("Double-booked venue");
  expect(notification.message).toContain("Test Gala");
});

test("cancelling an already-cancelled event is rejected (idempotency)", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await cancelEvent({ eventId: event._id, actorUserId: organizer._id });

  await expect(
    cancelEvent({ eventId: event._id, actorUserId: organizer._id }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("only the event's organizer can cancel it", async () => {
  const organizer = await createUser();
  const outsider = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await expect(
    cancelEvent({ eventId: event._id, actorUserId: outsider._id }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
