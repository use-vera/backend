const { reportTicketHolderLocation } = require("../services/event.service");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

test("the ticket owner can report their own location", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await reportTicketHolderLocation({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    latitude: 6.4474,
    longitude: 3.4687,
  });

  expect(result.success).toBe(true);

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.holderLastLatitude).toBeCloseTo(6.4474);
  expect(refreshed.holderLastLongitude).toBeCloseTo(3.4687);
  expect(refreshed.holderLocationUpdatedAt).toBeInstanceOf(Date);
});

test("someone other than the ticket owner cannot report a location for it", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const stranger = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    reportTicketHolderLocation({
      ticketId: ticket._id,
      actorUserId: stranger._id,
      latitude: 6.4474,
      longitude: 3.4687,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.holderLastLatitude).toBeNull();
});

test("reporting a location twice overwrites the previous one and updates the timestamp", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await reportTicketHolderLocation({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    latitude: 6.4474,
    longitude: 3.4687,
  });

  const firstUpdate = await EventTicket.findById(ticket._id);

  await reportTicketHolderLocation({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    latitude: 9.0765,
    longitude: 7.4896,
  });

  const secondUpdate = await EventTicket.findById(ticket._id);
  expect(secondUpdate.holderLastLatitude).toBeCloseTo(9.0765);
  expect(secondUpdate.holderLastLongitude).toBeCloseTo(7.4896);
  expect(secondUpdate.holderLocationUpdatedAt.getTime()).toBeGreaterThanOrEqual(
    firstUpdate.holderLocationUpdatedAt.getTime(),
  );
});
