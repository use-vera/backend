const { checkInTicket } = require("../services/event.service");
const GeofenceOverrideLog = require("../models/geofence-override-log.model");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

// createEvent's fixture default is 6.5244, 3.3792 (Lagos) with the default
// geofenceRadiusMeters of 150.
const INSIDE = { latitude: 6.5244, longitude: 3.37925 }; // a few meters away
const OUTSIDE = { latitude: 9.0765, longitude: 7.4896 }; // Abuja, ~500km away

test("check-in succeeds when the scanner is inside the geofence", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode, ...INSIDE },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");
});

test("check-in outside the geofence is rejected with OUTSIDE_GEOFENCE and a distance", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    checkInTicket({
      actorUserId: organizer._id,
      payload: { code: ticket.ticketCode, ...OUTSIDE },
    }),
  ).rejects.toMatchObject({
    statusCode: 409,
    code: "OUTSIDE_GEOFENCE",
    details: expect.objectContaining({ allowedRadiusMeters: 150 }),
  });

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("paid");
});

test("check-in outside the geofence with override succeeds and writes an audit log", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode, ...OUTSIDE, override: true },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");

  const logs = await GeofenceOverrideLog.find({ ticketId: ticket._id });
  expect(logs).toHaveLength(1);
  expect(logs[0].allowedRadiusMeters).toBe(150);
  expect(logs[0].distanceMeters).toBeGreaterThan(150);
});

test("check-in with no location at all proceeds unconditionally, geofence skipped", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");

  const logs = await GeofenceOverrideLog.find({ ticketId: ticket._id });
  expect(logs).toHaveLength(0);
});

test("re-scanning an already-used ticket from far away still reports alreadyUsed, not a geofence error", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode, ...INSIDE },
  });

  const second = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode, ...OUTSIDE },
  });

  expect(second.alreadyUsed).toBe(true);
});
