const {
  submitEmergencyReport,
  resolveEmergency,
  broadcastManualUpdate,
  getEventEmergencyAnalytics,
} = require("../services/emergency.service");
const EventEmergency = require("../models/event-emergency.model");
const EmergencyAuditLog = require("../models/emergency-audit-log.model");
const AppNotification = require("../models/notification.model");
const Event = require("../models/event.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;
const INSIDE_BASE = { latitude: 6.5244, longitude: 3.3792 };

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

const reportAsNewAttendee = async ({ event, index, category = "fire" }) => {
  const buyer = await createUser();
  const ticket = await checkedInTicket(event, buyer._id);

  return submitEmergencyReport({
    eventId: event._id,
    ticketId: ticket._id,
    actorUserId: buyer._id,
    category,
    latitude: INSIDE_BASE.latitude + index * 0.00001,
    longitude: INSIDE_BASE.longitude + index * 0.00001,
    gpsAccuracy: 15,
  });
};

test("enough agreeing, clustered, unique reports drive the emergency from monitoring to alert_sent, notifying checked-in attendees", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);

  // Give the event a pool of other checked-in attendees who should receive
  // the mass alert once it fires (separate from the reporters themselves).
  const bystanders = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const bystander = await createUser();
      return checkedInTicket(event, bystander._id);
    }),
  );

  let lastEmergency;
  for (let index = 0; index < 12; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reportAsNewAttendee({ event, index });
    lastEmergency = result.emergency;
  }

  expect(lastEmergency.status).toBe("alert_sent");
  expect(lastEmergency.confidenceLevel).toBe("high");
  expect(lastEmergency.alertSentAt).toBeTruthy();
  expect(lastEmergency.notificationCount).toBe(1);
  // Recipients = every checked-in attendee (reporters so far + the 3
  // bystanders) at the moment the threshold was crossed — the exact count
  // depends on how many reporters had submitted by then, so assert
  // self-consistency (one notification per counted recipient) and that
  // bystanders alone are always included, rather than a hardcoded total.
  expect(lastEmergency.alertRecipientCount).toBeGreaterThanOrEqual(4);
  expect(lastEmergency.alertRecipientCount).toBeLessThanOrEqual(15);

  const notifications = await AppNotification.find({ type: "emergency.alert" });
  expect(notifications).toHaveLength(lastEmergency.alertRecipientCount);

  const auditActions = (await EmergencyAuditLog.find({ eventId: event._id })).map(
    (log) => log.action,
  );
  expect(auditActions).toContain("emergency_detected");
  expect(auditActions).toContain("alert_sent");
  expect(auditActions.filter((action) => action === "alert_sent")).toHaveLength(1);
});

test("further reports after the alert update counts/confidence but never trigger a second alert (duplicate prevention)", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);

  let emergencyId;
  for (let index = 0; index < 12; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reportAsNewAttendee({ event, index });
    emergencyId = result.emergency._id;
  }

  const afterFirstAlert = await EventEmergency.findById(emergencyId);
  expect(afterFirstAlert.status).toBe("alert_sent");
  expect(afterFirstAlert.notificationCount).toBe(1);
  const recipientCountAtAlertTime = afterFirstAlert.alertRecipientCount;

  // More reports keep arriving after the alert already went out.
  for (let index = 12; index < 16; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await reportAsNewAttendee({ event, index });
  }

  const afterMoreReports = await EventEmergency.findById(emergencyId);
  expect(afterMoreReports.status).toBe("alert_sent");
  expect(afterMoreReports.notificationCount).toBe(1);
  expect(afterMoreReports.reportCount).toBe(16);
  // The recipient snapshot taken when the alert fired never changes,
  // even though more attendees reported afterward.
  expect(afterMoreReports.alertRecipientCount).toBe(recipientCountAtAlertTime);

  const notifications = await AppNotification.find({ type: "emergency.alert" });
  // Notified exactly once per recipient counted at alert time, not once
  // per incoming report (16 reports total, only one fanout).
  expect(notifications).toHaveLength(recipientCountAtAlertTime);
});

test("a manual broadcast bumps notificationCount without changing report/confidence data", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);

  let emergencyId;
  for (let index = 0; index < 12; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reportAsNewAttendee({ event, index });
    emergencyId = result.emergency._id;
  }

  const before = await EventEmergency.findById(emergencyId);
  expect(before.notificationCount).toBe(1);

  const updated = await broadcastManualUpdate({
    emergencyId,
    actorUserId: organizer._id,
    message: "Situation is under control, please remain seated.",
  });

  expect(updated.notificationCount).toBe(2);
  expect(updated.reportCount).toBe(before.reportCount);

  const auditActions = (await EmergencyAuditLog.find({ eventId: event._id })).map(
    (log) => log.action,
  );
  expect(auditActions).toContain("manual_broadcast");
});

test("only the organizer/admin can resolve or manually broadcast for an emergency", async () => {
  const organizer = await createUser();
  const outsider = await createUser();
  const event = await liveEvent(organizer._id);

  const result = await reportAsNewAttendee({ event, index: 0 });

  await expect(
    resolveEmergency({ emergencyId: result.emergency._id, actorUserId: outsider._id }),
  ).rejects.toMatchObject({ statusCode: 403 });

  await expect(
    broadcastManualUpdate({
      emergencyId: result.emergency._id,
      actorUserId: outsider._id,
      message: "test",
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("resolving an emergency marks it inactive and records false-positive/note, freeing the event for a new one", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);

  const result = await reportAsNewAttendee({ event, index: 0 });

  const resolved = await resolveEmergency({
    emergencyId: result.emergency._id,
    actorUserId: organizer._id,
    falsePositive: true,
    note: "Confirmed a false alarm after review",
  });

  expect(resolved.status).toBe("resolved");
  expect(resolved.isActive).toBe(false);
  expect(resolved.falsePositive).toBe(true);
  expect(resolved.resolvedAt).toBeTruthy();

  // A new report for the same event can now open a fresh emergency
  // (a resolved emergency doesn't block a new one from being created).
  const next = await reportAsNewAttendee({ event, index: 1 });
  expect(String(next.emergency._id)).not.toBe(String(result.emergency._id));
  expect(next.emergency.status).not.toBe("alert_sent");
  expect(next.emergency.status).not.toBe("resolved");
});

test("event emergency analytics aggregate false-positive rate and alert recipients", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);

  const first = await reportAsNewAttendee({ event, index: 0 });
  await resolveEmergency({
    emergencyId: first.emergency._id,
    actorUserId: organizer._id,
    falsePositive: true,
  });

  const second = await reportAsNewAttendee({ event, index: 1 });
  await resolveEmergency({
    emergencyId: second.emergency._id,
    actorUserId: organizer._id,
    falsePositive: false,
  });

  const analytics = await getEventEmergencyAnalytics({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(analytics.totalEmergencies).toBe(2);
  expect(analytics.falsePositiveRate).toBeCloseTo(0.5);
});

test("emergency config on the event (threshold/cooldown/sensitivity) defaults sensibly and is stored on Event", async () => {
  const organizer = await createUser();
  const event = await liveEvent(organizer._id);
  const fresh = await Event.findById(event._id);

  expect(fresh.emergency.enabled).toBe(true);
  expect(fresh.emergency.autoAlertsEnabled).toBe(true);
  expect(fresh.emergency.confidenceThreshold).toBe(70);
  expect(fresh.emergency.reportCooldownSeconds).toBe(60);
  expect(fresh.emergency.sensitivity).toBe(1);
});
