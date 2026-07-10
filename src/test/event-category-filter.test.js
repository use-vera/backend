const { listEvents, listPublicEvents } = require("../services/event.service");
const { createCategory } = require("../services/category.service");
const { createUser, createEvent } = require("./fixtures");

test("listEvents filters by a single category id", async () => {
  const organizer = await createUser();
  const music = await createCategory({ name: "Music A", iconKey: "music" });
  const sports = await createCategory({ name: "Sports A", iconKey: "sports" });

  await createEvent({
    organizerUserId: organizer._id,
    name: "Music Night",
    categoryIds: [music._id],
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Football Watch Party",
    categoryIds: [sports._id],
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
  });
  await createEvent({
    organizerUserId: organizer._id,
    name: "Uncategorized Event",
  });

  const result = await listPublicEvents({
    filter: "all",
    category: String(comedy._id),
  });

  expect(result.items.map((item) => item.name)).toEqual(["Stand-up Night"]);
});
