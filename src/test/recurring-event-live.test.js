const { listEvents, listPublicEvents } = require("../services/event.service");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

// Regression test for a real bug: a weekly-recurring event that started
// earlier today and hasn't ended yet (currently live) was being excluded
// entirely from listings. getNextRecurringOccurrenceStart treated any
// occurrence whose START time had passed as ineligible ("candidate <
// reference"), rather than only excluding occurrences that had fully
// ENDED — so it skipped today's still-ongoing occurrence and searched for
// the next one 3 weeks out, which landed past the recurrence's endsOn and
// made the whole event vanish from every listing.
test("a currently-live weekly-recurring event (started today, not yet ended) still shows up", async () => {
  const organizer = await createUser();
  const now = new Date();
  const todayWeekday = now.getDay();

  const event = await createEvent({
    organizerUserId: organizer._id,
    name: "Live Recurring Festival",
    startsAt: new Date(now.getTime() - 2 * HOUR_MS),
    endsAt: new Date(now.getTime() + 2 * HOUR_MS),
    recurrence: {
      type: "weekly",
      interval: 3,
      daysOfWeek: [todayWeekday],
      // Ends before the next 3-week-interval occurrence would land — if
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
