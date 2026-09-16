const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR_MS = 60 * 60 * 1000;

const ticketFor = (event, user, { checkedIn }) =>
  createPaidTicket({
    event,
    buyerUserId: user._id,
    ...(checkedIn ? { status: "used", usedAt: new Date() } : {}),
  });

test("discover ranks people you were checked in with, and only them", async () => {
  const organizer = await createUser();
  const me = await createUser({ fullName: "Me Myself" });
  const met = await createUser({ fullName: "Bisi Met" });
  const noShow = await createUser({ fullName: "Chidi Noshow" });
  const stranger = await createUser({ fullName: "Zara Stranger" });

  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() - 4 * HOUR_MS),
    endsAt: new Date(Date.now() - HOUR_MS),
  });

  await ticketFor(event, me, { checkedIn: true });
  await ticketFor(event, met, { checkedIn: true });
  /* Bought a ticket but never came. Surfacing them would leak that they
     meant to be at an event they did not attend. */
  await ticketFor(event, noShow, { checkedIn: false });

  const response = await request(app)
    .get("/api/chats/users?page=1&limit=50")
    .set("Authorization", auth(me));

  expect(response.status).toBe(200);

  const rows = response.body.data.items;
  const byName = (name) => rows.find((row) => row.fullName === name);

  // The person actually in the room with me is flagged and named.
  expect(byName("Bisi Met").sharedEventCount).toBe(1);
  expect(byName("Bisi Met").sharedEventName).toBe(event.name);

  // Everyone else is still discoverable, but carries no shared-event claim.
  expect(byName("Chidi Noshow").sharedEventCount).toBe(0);
  expect(byName("Zara Stranger").sharedEventCount).toBe(0);

  // And I am never in my own results.
  expect(byName("Me Myself")).toBeUndefined();

  // Ranked first, ahead of people I have never met.
  const metIndex = rows.findIndex((row) => row.fullName === "Bisi Met");
  const strangerIndex = rows.findIndex((row) => row.fullName === "Zara Stranger");
  expect(metIndex).toBeLessThan(strangerIndex);
});

test("a viewer who has attended nothing still gets a usable Discover list", async () => {
  const fresh = await createUser({ fullName: "Brand New" });
  await createUser({ fullName: "Someone Else" });

  const response = await request(app)
    .get("/api/chats/users?page=1&limit=50")
    .set("Authorization", auth(fresh));

  expect(response.status).toBe(200);
  expect(response.body.data.items.length).toBeGreaterThan(0);
  expect(
    response.body.data.items.every((row) => row.sharedEventCount === 0),
  ).toBe(true);
});
