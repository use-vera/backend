const { submitEmergencyReport } = require("../services/emergency.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

// createEvent's fixture default venue is 6.5244, 3.3792 (Lagos) with the
// default geofenceRadiusMeters of 150.
const INSIDE = { latitude: 6.5244, longitude: 3.37925, gpsAccuracy: 15 };
const OUTSIDE = { latitude: 9.0765, longitude: 7.4896, gpsAccuracy: 15 };

const liveEvent = (organizerUserId, overrides = {}) =>
  createEvent({
    organizerUserId,
    startsAt: new Date(Date.now() - 2 * HOUR_MS),
    endsAt: new Date(Date.now() + 2 * HOUR_MS),
    ...overrides,
  });

const checkedInTicket = async (event, buyerUserId) => {
  const ticket = await createPaidTicket({ event, buyerUserId });
  ticket.status = "used";
  ticket.usedAt = new Date();
  await ticket.save();
  return ticket;
};

test("a checked-in attendee inside the geofence can submit a report", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await checkedInTicket(event, buyer._id);

  const { report } = await submitEmergencyReport({
    eventId: event._id,
    ticketId: ticket._id,
    actorUserId: buyer._id,
    category: "fire",
    latitude: INSIDE.latitude,
    longitude: INSIDE.longitude,
    gpsAccuracy: INSIDE.gpsAccuracy,
  });

  expect(report.category).toBe("fire");
  expect(String(report.attendeeUserId)).toBe(String(buyer._id));
});

test("a non-checked-in attendee is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id }); // status "paid", not "used"

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: buyer._id,
      category: "fire",
      ...INSIDE,
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "TICKET_NOT_CHECKED_IN" });
});

test("a report outside the geofence is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await checkedInTicket(event, buyer._id);

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: buyer._id,
      category: "fire",
      ...OUTSIDE,
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "OUTSIDE_EVENT_GEOFENCE" });
});

test("a report for an event that hasn't started yet is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id, {
    startsAt: new Date(Date.now() + HOUR_MS),
    endsAt: new Date(Date.now() + 3 * HOUR_MS),
  });
  const ticket = await checkedInTicket(event, buyer._id);

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: buyer._id,
      category: "fire",
      ...INSIDE,
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "EVENT_NOT_ACTIVE" });
});

test("a report for an event that has already ended is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id, {
    startsAt: new Date(Date.now() - 3 * HOUR_MS),
    endsAt: new Date(Date.now() - HOUR_MS),
  });
  const ticket = await checkedInTicket(event, buyer._id);

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: buyer._id,
      category: "fire",
      ...INSIDE,
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "EVENT_NOT_ACTIVE" });
});

test("a report with a weak GPS fix is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await checkedInTicket(event, buyer._id);

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: buyer._id,
      category: "fire",
      latitude: INSIDE.latitude,
      longitude: INSIDE.longitude,
      gpsAccuracy: 500,
    }),
  ).rejects.toMatchObject({ statusCode: 400, code: "LOCATION_ACCURACY_TOO_LOW" });
});

test("reporting for someone else's ticket is rejected", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const impostor = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await checkedInTicket(event, buyer._id);

  await expect(
    submitEmergencyReport({
      eventId: event._id,
      ticketId: ticket._id,
      actorUserId: impostor._id,
      category: "fire",
      ...INSIDE,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("resubmitting within the cooldown updates the existing report instead of creating a new one", async () => {
  const EmergencyReport = require("../models/emergency-report.model");
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await liveEvent(organizer._id);
  const ticket = await checkedInTicket(event, buyer._id);

  const first = await submitEmergencyReport({
    eventId: event._id,
    ticketId: ticket._id,
    actorUserId: buyer._id,
    category: "fire",
    description: "smoke near stage",
    ...INSIDE,
  });

  const second = await submitEmergencyReport({
    eventId: event._id,
    ticketId: ticket._id,
    actorUserId: buyer._id,
    category: "fire",
    description: "smoke is spreading",
    ...INSIDE,
  });

  expect(String(second.report._id)).toBe(String(first.report._id));

  const allReportsForAttendee = await EmergencyReport.find({
    eventId: event._id,
    attendeeUserId: buyer._id,
  });
  expect(allReportsForAttendee).toHaveLength(1);
  expect(allReportsForAttendee[0].description).toBe("smoke is spreading");
});
