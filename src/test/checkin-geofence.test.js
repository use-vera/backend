const { checkInTicket } = require("../services/event.service");
const GeofenceOverrideLog = require("../models/geofence-override-log.model");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

// createEvent's fixture default is 6.5244, 3.3792 (Lagos) with the default
// geofenceRadiusMeters of 150.
const INSIDE = { latitude: 6.5244, longitude: 3.37925 }; // a few meters away
const OUTSIDE = { latitude: 9.0765, longitude: 7.4896 }; // Abuja, ~500km away

// Geofencing now reads the TICKET HOLDER's self-reported location (set via
// reportTicketHolderLocation when they open their ticket pass), not
// anything passed in the check-in payload — these helpers simulate that
// prior report directly on the ticket document.
const setHolderLocation = async (ticket, coords, { ageMs = 0 } = {}) => {
  ticket.holderLastLatitude = coords.latitude;
  ticket.holderLastLongitude = coords.longitude;
  ticket.holderLocationUpdatedAt = new Date(Date.now() - ageMs);
  await ticket.save();
};

test("check-in succeeds when the ticket holder's reported location is inside the geofence", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await setHolderLocation(ticket, INSIDE);

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");
  expect(result.ticket.checkInLatitude).toBeCloseTo(INSIDE.latitude);
  expect(result.ticket.checkInLongitude).toBeCloseTo(INSIDE.longitude);
});

test("check-in is rejected with OUTSIDE_GEOFENCE and a distance when the holder is far away", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await setHolderLocation(ticket, OUTSIDE);

  await expect(
    checkInTicket({
      actorUserId: organizer._id,
      payload: { code: ticket.ticketCode },
    }),
  ).rejects.toMatchObject({
    statusCode: 409,
    code: "OUTSIDE_GEOFENCE",
    message: expect.stringContaining("ticket holder"),
    details: expect.objectContaining({ allowedRadiusMeters: 150 }),
  });

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("paid");
  expect(refreshed.checkInLatitude).toBeNull();
});

test("check-in outside the geofence with override succeeds and writes an audit log", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await setHolderLocation(ticket, OUTSIDE);

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode, override: true },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");
  expect(result.ticket.checkInLatitude).toBeCloseTo(OUTSIDE.latitude);

  const logs = await GeofenceOverrideLog.find({ ticketId: ticket._id });
  expect(logs).toHaveLength(1);
  expect(logs[0].allowedRadiusMeters).toBe(150);
  expect(logs[0].distanceMeters).toBeGreaterThan(150);
});

test("check-in proceeds unconditionally when the holder never reported a location, geofence skipped", async () => {
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
  expect(result.ticket.checkInLatitude).toBeNull();

  const logs = await GeofenceOverrideLog.find({ ticketId: ticket._id });
  expect(logs).toHaveLength(0);
});

test("a stale holder location (older than the 30-minute window) is treated as absent, geofence skipped", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await setHolderLocation(ticket, OUTSIDE, { ageMs: 45 * 60 * 1000 });

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");
  expect(result.ticket.checkInLatitude).toBeNull();
});

test("re-scanning an already-used ticket still reports alreadyUsed, not a geofence error", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  await setHolderLocation(ticket, INSIDE);

  await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  const second = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  expect(second.alreadyUsed).toBe(true);
});
