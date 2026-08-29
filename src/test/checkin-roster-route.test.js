const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const tokenFor = (user) => signAccessToken({ userId: String(user._id) });

test("the roster route returns a usable roster over HTTP", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  await createPaidTicket({ event, buyerUserId: buyer._id });

  const response = await request(app)
    .get(`/api/events/${event._id}/checkin/roster`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`);

  if (response.status !== 200) {
    // Surface the real cause rather than a bare status mismatch.
    console.error("ROSTER FAILED", response.status, response.body);
  }

  expect(response.status).toBe(200);
  expect(response.body.data.tickets).toHaveLength(1);
  expect(response.body.data.rosterKey).toEqual(expect.any(String));
});

test("registering a door over HTTP returns the device", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const response = await request(app)
    .post(`/api/events/${event._id}/checkin/devices`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ label: "Door 1" });

  if (response.status >= 400) {
    console.error("DEVICE FAILED", response.status, response.body);
  }

  expect([200, 201]).toContain(response.status);
  expect(response.body.data.label).toBe("Door 1");
});

test("batch sync and conflicts respond over HTTP", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });
  const token = tokenFor(organizer);

  const device = await request(app)
    .post(`/api/events/${event._id}/checkin/devices`)
    .set("Authorization", `Bearer ${token}`)
    .send({ label: "Door 1" });

  const sync = await request(app)
    .post(`/api/events/${event._id}/checkin/batch`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      deviceId: device.body.data._id,
      entries: [
        { clientSeq: 1, code: ticket.ticketCode, scannedAt: new Date().toISOString() },
      ],
    });

  expect(sync.status).toBe(200);
  expect(sync.body.data.accepted).toBe(1);

  const doors = await request(app)
    .get(`/api/events/${event._id}/checkin/devices`)
    .set("Authorization", `Bearer ${token}`);

  expect(doors.status).toBe(200);
  expect(doors.body.data.items[0].admitted).toBe(1);

  const conflicts = await request(app)
    .get(`/api/events/${event._id}/checkin/conflicts`)
    .set("Authorization", `Bearer ${token}`);

  expect(conflicts.status).toBe(200);
  expect(conflicts.body.data.items).toEqual([]);

  const revoke = await request(app)
    .delete(`/api/events/${event._id}/checkin/devices/${device.body.data._id}`)
    .set("Authorization", `Bearer ${token}`);

  expect(revoke.status).toBe(200);
});
