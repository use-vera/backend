/* Discover's calendar: which days have something on, and one day's list. */

const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const { createUser, createEvent } = require("./fixtures");

const DAY = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = 60 * 60 * 1000;
const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;

/* 8PM Lagos time, `days` days from today, as a real instant. */
const lagosEvening = (days) => {
  const local = new Date(Date.now() + LAGOS_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, 20) - LAGOS_OFFSET);
};
const keyOf = (date) => new Date(date.getTime() + LAGOS_OFFSET).toISOString().slice(0, 10);
const monthOf = (date) => keyOf(date).slice(0, 7);

const get = (user, path) => request(app).get(`/api/events${path}`).set("Authorization", auth(user));

describe("discover calendar", () => {
  test("marks every day an event runs, counts each event once a day, and skips drafts and other cities", async () => {
    const host = await createUser();
    const me = await createUser();
    const day = lagosEvening(40);
    const festivalStart = lagosEvening(42);

    await createEvent({ organizerUserId: host._id, name: "Night A", startsAt: day, endsAt: new Date(day.getTime() + 3 * 3600000), state: "Lagos" });
    await createEvent({ organizerUserId: host._id, name: "Night B", startsAt: day, endsAt: new Date(day.getTime() + 2 * 3600000), state: "Lagos" });
    await createEvent({ organizerUserId: host._id, name: "Draft", status: "draft", startsAt: day, endsAt: new Date(day.getTime() + 3600000), state: "Lagos" });
    await createEvent({ organizerUserId: host._id, name: "Abuja Night", startsAt: day, endsAt: new Date(day.getTime() + 3600000), state: "Abuja" });
    /* Three days: Friday evening to Sunday evening. */
    await createEvent({ organizerUserId: host._id, name: "Festival", startsAt: festivalStart, endsAt: new Date(festivalStart.getTime() + 2 * DAY), state: "Lagos" });

    const counts = {};
    for (const month of new Set([monthOf(day), monthOf(festivalStart), monthOf(new Date(festivalStart.getTime() + 2 * DAY))])) {
      const res = await get(me, `/discover/calendar?month=${month}&state=Lagos`);
      expect(res.status).toBe(200);
      for (const entry of res.body.data.days) counts[entry.date] = entry.count;
    }

    expect(counts[keyOf(day)]).toBe(2);
    expect(counts[keyOf(festivalStart)]).toBe(1);
    expect(counts[keyOf(new Date(festivalStart.getTime() + DAY))]).toBe(1);
    expect(counts[keyOf(new Date(festivalStart.getTime() + 2 * DAY))]).toBe(1);
  });

  test("a month that's over is empty, and a bad month is refused", async () => {
    const me = await createUser();
    const past = await get(me, "/discover/calendar?month=2020-01");
    expect(past.status).toBe(200);
    expect(past.body.data.days).toEqual([]);
    await get(me, "/discover/calendar?month=2026-13").expect(400);
  });

  test("one day's list, even months away", async () => {
    const host = await createUser();
    const me = await createUser();
    const far = lagosEvening(75);
    await createEvent({ organizerUserId: host._id, name: "Far Night", startsAt: far, endsAt: new Date(far.getTime() + 3 * 3600000), state: "Lagos" });
    await createEvent({ organizerUserId: host._id, name: "Next Day", startsAt: lagosEvening(76), endsAt: new Date(lagosEvening(76).getTime() + 3600000), state: "Lagos" });

    const res = await get(me, `/discover/list?on=${keyOf(far)}&sort=soonest`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((item) => item.name)).toEqual(["Far Night"]);

    await get(me, "/discover/list?on=2026-02-31x").expect(400);
  });
});
