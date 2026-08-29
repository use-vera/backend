const {
  getEventPage,
  saveEventPage,
  setEventPageStatus,
  checkSlug,
  getPublicEventPage,
} = require("../services/event-page.service");
const { createUser, createEvent } = require("./fixtures");

test("a new event gets starter blocks and a slug suggested from its name", async () => {
  const organizer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Afrobeats Night Lagos",
  });

  const { page, suggestedSlug, starterBlocks } = await getEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(page).toBeNull();
  expect(suggestedSlug).toBe("afrobeats-night-lagos");
  // A first page that already says something beats a blank canvas.
  expect(starterBlocks.map((block) => block.type)).toEqual([
    "hero",
    "text",
    "tickets",
    "venue",
    "footer",
  ]);
});

test("a page cannot take an address the app already routes", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const result = await checkSlug({
    slug: "organizer",
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(result.available).toBe(false);
  expect(result.reason).toMatch(/reserved/i);
});

test("two events cannot share an address", async () => {
  const organizer = await createUser();
  const first = await createEvent({ organizerUserId: organizer._id });
  const second = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: first._id,
    actorUserId: organizer._id,
    payload: { slug: "block-party" },
  });

  const check = await checkSlug({
    slug: "block-party",
    eventId: second._id,
    actorUserId: organizer._id,
  });

  expect(check.available).toBe(false);
  expect(check.reason).toMatch(/taken/i);
});

test("changing the address keeps the old one working, so printed links survive", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "old-name" },
  });
  await setEventPageStatus({
    eventId: event._id,
    actorUserId: organizer._id,
    status: "published",
  });
  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "new-name" },
  });

  const viaNew = await getPublicEventPage({ slug: "new-name" });
  expect(viaNew.canonicalSlug).toBe("new-name");
  expect(viaNew.redirected).toBe(false);

  const viaOld = await getPublicEventPage({ slug: "old-name" });
  expect(viaOld.canonicalSlug).toBe("new-name");
  // The client is told to correct the address without the link breaking.
  expect(viaOld.redirected).toBe(true);

  // And nobody else may claim the retired address.
  const other = await createEvent({ organizerUserId: organizer._id });
  const check = await checkSlug({
    slug: "old-name",
    eventId: other._id,
    actorUserId: organizer._id,
  });
  expect(check.available).toBe(false);
});

test("a draft page is not readable by the public", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "hidden-thing" },
  });

  await expect(getPublicEventPage({ slug: "hidden-thing" })).rejects.toMatchObject({
    statusCode: 404,
  });
});

test("only the event's creator can edit its page", async () => {
  const organizer = await createUser();
  const stranger = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await expect(
    saveEventPage({
      eventId: event._id,
      actorUserId: stranger._id,
      payload: { slug: "not-yours" },
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("a published page carries the mapped event, not the raw document", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "mapped-event" },
  });
  await setEventPageStatus({
    eventId: event._id,
    actorUserId: organizer._id,
    status: "published",
  });

  const { event: mapped } = await getPublicEventPage({ slug: "mapped-event" });

  // These are derived by mapEventForResponse and absent from the document.
  // Reading the raw doc here crashed the landing page's date formatter.
  expect(typeof mapped.nextOccurrenceAt).toBe("string");
  expect(Number.isNaN(new Date(mapped.nextOccurrenceAt).getTime())).toBe(false);
  expect(typeof mapped.nextOccurrenceEndsAt).toBe("string");
  expect(mapped.salePhase).toBeDefined();
  expect(typeof mapped.remainingTickets).toBe("number");
});

test("pulling an event down takes its landing page with it", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "gone-quiet" },
  });
  await setEventPageStatus({
    eventId: event._id,
    actorUserId: organizer._id,
    status: "published",
  });

  expect(await getPublicEventPage({ slug: "gone-quiet" })).toBeDefined();

  event.status = "draft";
  await event.save();

  // Reported against the page, not the event the visitor never asked about.
  await expect(getPublicEventPage({ slug: "gone-quiet" })).rejects.toMatchObject({
    statusCode: 404,
    message: "Page not found",
  });
});

test("a published page carries what the live-data blocks need", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "live-data" },
  });
  await setEventPageStatus({
    eventId: event._id,
    actorUserId: organizer._id,
    status: "published",
  });

  const page = await getPublicEventPage({ slug: "live-data" });

  // The reviews block needs the aggregate and the written reviews beside it.
  expect(page.ratings).toBeDefined();
  expect(typeof page.ratings.ratingsCount).toBe("number");
  expect(Array.isArray(page.ratings.items)).toBe(true);

  // Mirrors the event's own policy, and reports an empty marketplace as empty
  // rather than leaving the block to invent a number.
  expect(page.resale.enabled).toBe(Boolean(event.resale?.enabled));
  expect(page.resale.listingCount).toBe(0);
  expect(page.resale.fromPriceNaira).toBeNull();
});

test("a page saved under the old font names still saves", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { slug: "old-font", theme: { preset: "paper", font: "serif" } },
  });

  // Read back translated, so the builder shows the right row selected.
  const { page } = await getEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
  });
  expect(page.theme.font).toBe("classic");

  // Switching only the preset used to fail: the stale font rode along on the
  // merge and the model's enum rejected the whole save.
  const saved = await saveEventPage({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { theme: { preset: "noir", font: "grotesk" } },
  });

  expect(saved.theme.preset).toBe("noir");
  expect(saved.theme.font).toBe("modern");
});
