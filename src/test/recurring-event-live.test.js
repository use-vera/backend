const {
  listEvents,
  listPublicEvents,
  resolveOccurrenceWindow,
} = require("../services/event.service");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

// Regression test for a real bug: a weekly-recurring event that started
// earlier today and hasn't ended yet (currently live) was being excluded
// entirely from listings. getNextRecurringOccurrenceStart treated any
// occurrence whose START time had passed as ineligible ("candidate <
// reference"), rather than only excluding occurrences that had fully
// ENDED, so it skipped today's still-ongoing occurrence and searched for
// the next one 3 weeks out, which landed past the recurrence's endsOn and
// made the whole event vanish from every listing.
test("a currently-live weekly-recurring event (started today, not yet ended) still shows up", async () => {
  const organizer = await createUser();
  const now = new Date();
  const startsAt = new Date(now.getTime() - 2 * HOUR_MS);
  const endsAt = new Date(now.getTime() + 2 * HOUR_MS);
  // Taken from the occurrence's own start, not from "today". Between local
  // midnight and 02:00 those are different days, and a recurrence pointed at
  // today would correctly resolve to tomorrow. Failing the suite nightly for
  // a reason that has nothing to do with the bug under test.
  const occurrenceWeekday = startsAt.getDay();

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Live Recurring Festival",
    startsAt,
    endsAt,
    recurrence: {
      type: "weekly",
      interval: 3,
      daysOfWeek: [occurrenceWeekday],
      // Ends before the next 3-week-interval occurrence would land. If
      // today's live occurrence is wrongly skipped, the search for the
      // next matching date lands after this and the event disappears
      // entirely, reproducing the original bug exactly.
      endsOn: new Date(now.getTime() + 3 * 24 * HOUR_MS),
    },
  });

  const result = await listEvents({ actorUserId: organizer._id, filter: "all" });
  const found = result.items.find((item) => item._id.toString() === event._id.toString());

  expect(found).toBeDefined();
  expect(new Date(found.nextOccurrenceAt).getTime()).toBe(event.startsAt.getTime());
  expect(new Date(found.nextOccurrenceEndsAt).getTime()).toBe(event.endsAt.getTime());

  const publicResult = await listPublicEvents({ filter: "all" });
  const foundPublic = publicResult.items.find(
    (item) => item._id.toString() === event._id.toString(),
  );

  expect(foundPublic).toBeDefined();
});

// A club night runs 23:00 to 04:00. At 01:00 it is halfway through, but the
// occurrence began yesterday. The forward scan started at "today" and never
// generated yesterday's date, so the event vanished from every listing at
// midnight, while people were still inside it.
test("a recurring occurrence that runs past midnight stays live after midnight", async () => {
  const organizer = await createUser();

  // Fixed clock: this must not depend on when the suite happens to run.
  const startsAt = new Date("2026-03-06T23:00:00.000Z");
  const endsAt = new Date("2026-03-07T04:00:00.000Z");
  const duringTheNight = new Date("2026-03-07T01:00:00.000Z");

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Midnight Recurring Session",
    startsAt,
    endsAt,
    recurrence: {
      type: "weekly",
      interval: 1,
      daysOfWeek: [startsAt.getDay()],
      endsOn: new Date("2026-06-06T00:00:00.000Z"),
    },
  });

  const occurrence = resolveOccurrenceWindow(event, duringTheNight);

  expect(occurrence).not.toBeNull();
  // Still last night's occurrence, not next week's.
  expect(occurrence.startsAt.getTime()).toBe(startsAt.getTime());
  expect(occurrence.endsAt.getTime()).toBe(endsAt.getTime());
});

test("an occurrence that has fully ended rolls on to the next one", async () => {
  const organizer = await createUser();

  const startsAt = new Date("2026-03-06T23:00:00.000Z");
  const endsAt = new Date("2026-03-07T04:00:00.000Z");
  // Two hours after it finished. Looking back must not resurrect it.
  const afterItEnded = new Date("2026-03-07T06:00:00.000Z");

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Finished Recurring Session",
    startsAt,
    endsAt,
    recurrence: {
      type: "weekly",
      interval: 1,
      daysOfWeek: [startsAt.getDay()],
      endsOn: new Date("2026-06-06T00:00:00.000Z"),
    },
  });

  const occurrence = resolveOccurrenceWindow(event, afterItEnded);

  expect(occurrence).not.toBeNull();
  expect(occurrence.startsAt.getTime()).toBe(startsAt.getTime() + 7 * 24 * HOUR_MS);
});
