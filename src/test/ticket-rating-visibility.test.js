const { listMyTickets, rateEvent } = require("../services/event.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

test("listMyTickets exposes myRating on the populated event, null until rated", async () => {
  const organizer = await createUser();
  const buyer = await createUser();

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Ended Meetup",
    startsAt: new Date(Date.now() - 26 * HOUR_MS),
    endsAt: new Date(Date.now() - 24 * HOUR_MS),
  });

  await createPaidTicket({ event, buyerUserId: buyer._id });

  const beforeRating = await listMyTickets({ actorUserId: buyer._id });
  expect(beforeRating.items).toHaveLength(1);
  expect(beforeRating.items[0].eventId.myRating).toBeNull();

  await rateEvent({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { rating: 5, review: "Great time" },
  });

  const afterRating = await listMyTickets({ actorUserId: buyer._id });
  expect(afterRating.items[0].eventId.myRating).toBe(5);
});

test("listMyTickets does not leak another buyer's rating as myRating", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const otherBuyer = await createUser();

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Ended Meetup Two",
    startsAt: new Date(Date.now() - 26 * HOUR_MS),
    endsAt: new Date(Date.now() - 24 * HOUR_MS),
  });

  await createPaidTicket({ event, buyerUserId: buyer._id });
  await createPaidTicket({ event, buyerUserId: otherBuyer._id });

  await rateEvent({
    eventId: event._id,
    actorUserId: otherBuyer._id,
    payload: { rating: 4 },
  });

  const result = await listMyTickets({ actorUserId: buyer._id });
  expect(result.items[0].eventId.myRating).toBeNull();
});
