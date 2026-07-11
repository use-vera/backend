const { listEvents, listPublicEvents } = require("../services/event.service");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

test('a past event is hidden under filter "all", not just "upcoming"', async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Ended Yesterday",
    startsAt: new Date(Date.now() - 26 * HOUR_MS),
    endsAt: new Date(Date.now() - 24 * HOUR_MS),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Happening Tomorrow",
    startsAt: new Date(Date.now() + 24 * HOUR_MS),
    endsAt: new Date(Date.now() + 26 * HOUR_MS),
  });

  const result = await listEvents({ actorUserId: organizer._id, filter: "all" });

  expect(result.items.map((item) => item.name)).toEqual(["Happening Tomorrow"]);
});

test("a currently-live event (started, not yet ended) stays visible under filter \"all\"", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Live Right Now",
    startsAt: new Date(Date.now() - HOUR_MS),
    endsAt: new Date(Date.now() + HOUR_MS),
  });

  const result = await listEvents({ actorUserId: organizer._id, filter: "all" });

  expect(result.items.map((item) => item.name)).toEqual(["Live Right Now"]);
});

test("an explicit past date range (from/to) is the one escape hatch that surfaces ended events", async () => {
  const organizer = await createUser();

  const threeDaysAgoStart = new Date(Date.now() - 3 * 24 * HOUR_MS);
  const threeDaysAgoEnd = new Date(threeDaysAgoStart.getTime() + 2 * HOUR_MS);

  await createEvent({
    organizerUserId: organizer._id,
    name: "Three Days Ago Concert",
    startsAt: threeDaysAgoStart,
    endsAt: threeDaysAgoEnd,
  });

  // Without an explicit date query, it's hidden like any other past event.
  const withoutDateQuery = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
  });
  expect(withoutDateQuery.items.map((item) => item.name)).toEqual([]);

  // Searching that specific past day surfaces it.
  const withDateQuery = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
    from: new Date(threeDaysAgoStart.getTime() - HOUR_MS).toISOString(),
    to: new Date(threeDaysAgoEnd.getTime() + HOUR_MS).toISOString(),
  });
  expect(withDateQuery.items.map((item) => item.name)).toEqual([
    "Three Days Ago Concert",
  ]);
});

test("listPublicEvents applies the same past-event visibility rule", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Ended Yesterday",
    startsAt: new Date(Date.now() - 26 * HOUR_MS),
    endsAt: new Date(Date.now() - 24 * HOUR_MS),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Happening Tomorrow",
    startsAt: new Date(Date.now() + 24 * HOUR_MS),
    endsAt: new Date(Date.now() + 26 * HOUR_MS),
  });

  const result = await listPublicEvents({ filter: "all" });

  expect(result.items.map((item) => item.name)).toEqual(["Happening Tomorrow"]);
});
