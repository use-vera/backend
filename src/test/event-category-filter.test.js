const { listEvents, listPublicEvents } = require("../services/event.service");
const { createCategory } = require("../services/category.service");
const { createUser, createEvent } = require("./fixtures");

// createEvent's fixture defaults to an already-ended event; these tests
// care about category matching, not date filtering, so give every event a
// genuinely future window — otherwise the "hide ended events" behavior
// (confirmed via event-visibility.test.js) would exclude them regardless
// of category.
const upcoming = () => ({
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 27 * 60 * 60 * 1000),
});

test("listEvents filters by a single category id", async () => {
  const organizer = await createUser();
  const music = await createCategory({ name: "Music A", iconKey: "music" });
  const sports = await createCategory({ name: "Sports A", iconKey: "sports" });

  await createEvent({
    organizerUserId: organizer._id,
    name: "Music Night",
    categoryIds: [music._id],
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Football Watch Party",
    categoryIds: [sports._id],
    ...upcoming(),
  });

  const result = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
    category: String(music._id),
  });

  expect(result.items.map((item) => item.name)).toEqual(["Music Night"]);
});

test("an event tagged with multiple categories matches a filter on any one of them", async () => {
  const organizer = await createUser();
  const music = await createCategory({ name: "Music B", iconKey: "music" });
  const nightlife = await createCategory({ name: "Nightlife B", iconKey: "nightlife" });

  await createEvent({
    organizerUserId: organizer._id,
    name: "Music + Nightlife Crossover",
    categoryIds: [music._id, nightlife._id],
    ...upcoming(),
  });

  const byMusic = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
    category: String(music._id),
  });
  const byNightlife = await listEvents({
    actorUserId: organizer._id,
    filter: "all",
    category: String(nightlife._id),
  });

  expect(byMusic.items.map((item) => item.name)).toEqual(["Music + Nightlife Crossover"]);
  expect(byNightlife.items.map((item) => item.name)).toEqual(["Music + Nightlife Crossover"]);
});

test("listPublicEvents (unauthenticated listing) also supports the category filter", async () => {
  const organizer = await createUser();
  const comedy = await createCategory({ name: "Comedy A", iconKey: "comedy" });

  await createEvent({
    organizerUserId: organizer._id,
    name: "Stand-up Night",
    categoryIds: [comedy._id],
    ...upcoming(),
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Uncategorized Event",
    ...upcoming(),
  });

  const result = await listPublicEvents({
    filter: "all",
    category: String(comedy._id),
  });

  expect(result.items.map((item) => item.name)).toEqual(["Stand-up Night"]);
});
