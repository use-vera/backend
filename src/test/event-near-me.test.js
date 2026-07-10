const { listPublicEvents } = require("../services/event.service");
const { createUser, createEvent } = require("./fixtures");

// Lekki Phase 1, Lagos — reused from scripts/seed-events.js's location pool.
const LEKKI = { latitude: 6.4474, longitude: 3.4687 };
// Wuse 2, Abuja — several hundred km from Lekki, well outside any
// reasonable "near me" radius.
const ABUJA = { latitude: 9.0765, longitude: 7.4896 };

test("near-me query includes an event within the radius and excludes one far away", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Lekki Meetup",
    latitude: LEKKI.latitude,
    longitude: LEKKI.longitude,
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Abuja Conference",
    latitude: ABUJA.latitude,
    longitude: ABUJA.longitude,
  });

  const result = await listPublicEvents({
    filter: "all",
    nearLat: LEKKI.latitude,
    nearLng: LEKKI.longitude,
    nearRadiusKm: 25,
  });

  expect(result.items.map((item) => item.name)).toEqual(["Lekki Meetup"]);
});

test("near-me query respects a widened radius", async () => {
  const organizer = await createUser();

  // ~4km from LEKKI — inside a 10km radius, outside a 1km one.
  const nearbyLat = LEKKI.latitude + 0.036;

  await createEvent({
    organizerUserId: organizer._id,
    name: "Just Outside Lekki",
    latitude: nearbyLat,
    longitude: LEKKI.longitude,
  });

  const tight = await listPublicEvents({
    filter: "all",
    nearLat: LEKKI.latitude,
    nearLng: LEKKI.longitude,
    nearRadiusKm: 1,
  });
  const wide = await listPublicEvents({
    filter: "all",
    nearLat: LEKKI.latitude,
    nearLng: LEKKI.longitude,
    nearRadiusKm: 10,
  });

  expect(tight.items).toHaveLength(0);
  expect(wide.items.map((item) => item.name)).toEqual(["Just Outside Lekki"]);
});

test("omitting both nearLat and nearLng returns events regardless of location", async () => {
  const organizer = await createUser();

  await createEvent({
    organizerUserId: organizer._id,
    name: "Lekki Meetup",
    latitude: LEKKI.latitude,
    longitude: LEKKI.longitude,
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Abuja Conference",
    latitude: ABUJA.latitude,
    longitude: ABUJA.longitude,
  });

  const result = await listPublicEvents({ filter: "all" });

  expect(result.items.map((item) => item.name).sort()).toEqual([
    "Abuja Conference",
    "Lekki Meetup",
  ]);
});
