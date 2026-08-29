const {
  batchCheckInTickets,
  listCheckInConflicts,
} = require("../services/event.service");
const CheckInAttempt = require("../models/check-in-attempt.model");
const CheckInDevice = require("../models/check-in-device.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const makeDevice = (event, organizer, label) =>
  CheckInDevice.create({
    eventId: event._id,
    label,
    createdByUserId: organizer._id,
  });

test("a queued scan is admitted and stamped with the door's time, not the sync time", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  const door = await makeDevice(event, organizer, "Door 1");

  const scannedAt = new Date(Date.now() - 45 * 60 * 1000);

  const result = await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: {
      deviceId: String(door._id),
      entries: [{ clientSeq: 1, code: ticket.ticketCode, scannedAt }],
    },
  });

  expect(result.accepted).toBe(1);
  expect(result.results[0].result).toBe("admitted");

  const stored = await ticket.constructor.findById(ticket._id);
  expect(stored.status).toBe("used");
  expect(stored.usedVia).toBe("offline");
  expect(String(stored.usedByDeviceId)).toBe(String(door._id));
  // The admission is recorded at the moment the door decided.
  expect(stored.usedAt.getTime()).toBe(scannedAt.getTime());
});

test("re-sending the same batch does not double-apply", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  const door = await makeDevice(event, organizer, "Door 1");

  const payload = {
    deviceId: String(door._id),
    entries: [{ clientSeq: 7, code: ticket.ticketCode, scannedAt: new Date() }],
  };

  const first = await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload,
  });
  const second = await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload,
  });

  expect(first.results[0].result).toBe("admitted");
  expect(second.results[0].replayed).toBe(true);
  expect(second.results[0].result).toBe("admitted");

  // One admission recorded, not two.
  const admitted = await CheckInAttempt.countDocuments({
    ticketId: ticket._id,
    result: "admitted",
  });
  expect(admitted).toBe(1);
});

test("two doors scanning the same ticket: first to sync wins, second is a duplicate", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  const doorOne = await makeDevice(event, organizer, "Door 1");
  const doorThree = await makeDevice(event, organizer, "Door 3");

  // Door 3 scanned EARLIER but syncs second. Arrival decides, not the clock.
  const earlier = new Date(Date.now() - 20 * 60 * 1000);
  const later = new Date(Date.now() - 5 * 60 * 1000);

  await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: {
      deviceId: String(doorOne._id),
      entries: [{ clientSeq: 1, code: ticket.ticketCode, scannedAt: later }],
    },
  });

  const second = await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: {
      deviceId: String(doorThree._id),
      entries: [{ clientSeq: 1, code: ticket.ticketCode, scannedAt: earlier }],
    },
  });

  expect(second.duplicates).toBe(1);
  expect(second.results[0].result).toBe("duplicate");
  expect(second.results[0].firstDeviceLabel).toBe("Door 1");

  const conflicts = await listCheckInConflicts({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(conflicts.totalItems).toBe(1);
  expect(conflicts.items[0].admittedLane).toBe("Door 1");
  expect(conflicts.items[0].rescannedLane).toBe("Door 3");
});

test("one bad entry does not sink the rest of the batch", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const good = await createPaidTicket({ event, buyerUserId: buyer._id });
  const door = await makeDevice(event, organizer, "Door 1");

  const result = await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: {
      deviceId: String(door._id),
      entries: [
        { clientSeq: 1, code: "VRA-NOT-AREALCODE", scannedAt: new Date() },
        { clientSeq: 2, code: good.ticketCode, scannedAt: new Date() },
      ],
    },
  });

  expect(result.results[0].result).toBe("invalid");
  expect(result.results[1].result).toBe("admitted");
  expect(result.accepted).toBe(1);
  expect(result.rejected).toBe(1);
});

test("a revoked device cannot sync", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  const door = await makeDevice(event, organizer, "Door 1");

  door.revokedAt = new Date();
  await door.save();

  await expect(
    batchCheckInTickets({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: {
        deviceId: String(door._id),
        entries: [{ clientSeq: 1, code: ticket.ticketCode, scannedAt: new Date() }],
      },
    }),
  ).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
});

const { getCheckInRoster } = require("../services/event.service");
const crypto = require("crypto");

test("the roster hashes codes, carries no contact details, and omits refunded tickets", async () => {
  const organizer = await createUser();
  const buyer = await createUser({ fullName: "Amaka Obi" });
  const event = await createEvent({ organizerUserId: organizer._id });
  const good = await createPaidTicket({ event, buyerUserId: buyer._id });
  const refunded = await createPaidTicket({ event, buyerUserId: buyer._id });

  good.attendeeName = "Amaka Obi";
  await good.save();

  refunded.status = "refunded";
  await refunded.save();

  const roster = await getCheckInRoster({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  const serialised = JSON.stringify(roster.tickets);
  expect(serialised).not.toContain(good.ticketCode);
  expect(serialised).not.toContain(good.attendeeEmail);

  // The refunded ticket is revoked, not admissible.
  expect(roster.tickets).toHaveLength(1);
  expect(roster.revoked).toHaveLength(1);

  // A door can recompute the hash from the key it was given. This is the
  // contract the browser client depends on.
  const expected = crypto
    .createHmac("sha256", Buffer.from(roster.rosterKey, "hex"))
    .update(good.ticketCode.trim().toUpperCase())
    .digest("hex")
    .slice(0, 32);

  expect(roster.tickets[0].h).toBe(expected);
  expect(roster.tickets[0].name).toBe("Amaka O.");
});

test("a delta roster returns only what changed since the last sync", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  await createPaidTicket({ event, buyerUserId: buyer._id });

  const first = await getCheckInRoster({
    eventId: event._id,
    actorUserId: organizer._id,
  });
  expect(first.isDelta).toBe(false);
  expect(first.tickets).toHaveLength(1);

  const later = await createPaidTicket({ event, buyerUserId: buyer._id });

  const delta = await getCheckInRoster({
    eventId: event._id,
    actorUserId: organizer._id,
    since: first.serverTime,
  });

  expect(delta.isDelta).toBe(true);
  expect(delta.tickets).toHaveLength(1);
  expect(delta.tickets[0].h).toBe(
    crypto
      .createHmac("sha256", Buffer.from(delta.rosterKey, "hex"))
      .update(later.ticketCode.trim().toUpperCase())
      .digest("hex")
      .slice(0, 32),
  );
});

const {
  registerCheckInDevice,
  listCheckInDevices,
  revokeCheckInDevice,
} = require("../services/event.service");

test("registering the same lane twice returns the existing door, not a twin", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const first = await registerCheckInDevice({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { label: "Door 1" },
  });
  const again = await registerCheckInDevice({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { label: "Door 1" },
  });

  expect(first.reused).toBe(false);
  expect(again.reused).toBe(true);
  expect(String(again.device._id)).toBe(String(first.device._id));
});

test("revoking a door keeps its admissions attributed but blocks further syncing", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const { device } = await registerCheckInDevice({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { label: "Door 4" },
  });

  await batchCheckInTickets({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: {
      deviceId: String(device._id),
      entries: [{ clientSeq: 1, code: ticket.ticketCode, scannedAt: new Date() }],
    },
  });

  await revokeCheckInDevice({
    eventId: event._id,
    deviceId: device._id,
    actorUserId: organizer._id,
  });

  const doors = await listCheckInDevices({
    eventId: event._id,
    actorUserId: organizer._id,
  });
  const revoked = doors.items.find(
    (item) => String(item._id) === String(device._id),
  );

  // The history survives revocation. That is the point of not deleting.
  expect(revoked.admitted).toBe(1);
  expect(revoked.revokedAt).toBeTruthy();

  const other = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    batchCheckInTickets({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: {
        deviceId: String(device._id),
        entries: [{ clientSeq: 2, code: other.ticketCode, scannedAt: new Date() }],
      },
    }),
  ).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
});
