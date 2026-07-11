const { listEvents, listPublicEvents, listEventCountries } = require("../services/event.service");
const { resolveCountryFromCoordinates } = require("../constants/country-bounding-boxes");
const { createUser, createEvent } = require("./fixtures");

// createEvent's fixture defaults to an already-ended event; these tests
// care about country matching, not date filtering, so give every event a
// genuinely future window — otherwise the "hide ended events" behavior
// (confirmed via event-visibility.test.js) would exclude them regardless
// of country.
const upcoming = () => ({
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 27 * 60 * 60 * 1000),
});

// Lekki Phase 1, Lagos — reused from event-near-me.test.js's location pool.
const LAGOS = { latitude: 6.4474, longitude: 3.4687 };
// Central London.
const LONDON = { latitude: 51.5072, longitude: -0.1276 };
// Middle of the Pacific ocean — outside every bounding box.
const OCEAN = { latitude: 0, longitude: -160 };

test("resolveCountryFromCoordinates resolves known coordinates and falls back to Other", () => {
  expect(resolveCountryFromCoordinates(LAGOS.latitude, LAGOS.longitude)).toBe("Nigeria");
  expect(resolveCountryFromCoordinates(LONDON.latitude, LONDON.longitude)).toBe(
    "United Kingdom",
  );
  expect(resolveCountryFromCoordinates(OCEAN.latitude, OCEAN.longitude)).toBe("Other");
  expect(resolveCountryFromCoordinates(undefined, undefined)).toBe("Other");
});

test("listEvents filters by country (case-insensitive exact match)", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Lagos Meetup",
    latitude: LAGOS.latitude,
    longitude: LAGOS.longitude,
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "London Meetup",
    latitude: LONDON.latitude,
    longitude: LONDON.longitude,
    ...upcoming(),
  });

  const result = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
    country: "nigeria",
  });

  expect(result.items.map((item) => item.name)).toEqual(["Lagos Meetup"]);
});

test("listPublicEvents (unauthenticated listing) also supports the country filter", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Lagos Meetup",
    latitude: LAGOS.latitude,
    longitude: LAGOS.longitude,
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "London Meetup",
    latitude: LONDON.latitude,
    longitude: LONDON.longitude,
    ...upcoming(),
  });

  const result = await listPublicEvents({
    filter: "all",
    country: "United Kingdom",
  });

  expect(result.items.map((item) => item.name)).toEqual(["London Meetup"]);
});

test("listEventCountries counts published upcoming events per country and excludes ended ones", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Lagos Meetup",
    latitude: LAGOS.latitude,
    longitude: LAGOS.longitude,
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Another Lagos Meetup",
    latitude: LAGOS.latitude,
    longitude: LAGOS.longitude,
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "London Meetup",
    latitude: LONDON.latitude,
    longitude: LONDON.longitude,
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Ended Lagos Event",
    latitude: LAGOS.latitude,
    longitude: LAGOS.longitude,
    startsAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  const result = await listEventCountries();

  expect(result).toEqual([
    { country: "Nigeria", count: 2 },
    { country: "United Kingdom", count: 1 },
  ]);
});
