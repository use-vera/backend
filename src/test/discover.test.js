/* Phase 6: Home, Discover and the map. */

const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const Category = require("../models/category.model");
const { scoreMatch, weekendDays } = require("../services/discover.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR = 60 * 60 * 1000;
const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const inHours = (hours) => new Date(Date.now() + hours * HOUR);

const upcoming = (organizerUserId, overrides = {}) =>
  createEvent({ organizerUserId, startsAt: inHours(2), endsAt: inHours(6), state: "Lagos", ...overrides });

const makeCategory = (name) =>
  Category.create({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), iconKey: "music", sortOrder: 1, isActive: true });

describe("match score", () => {
  const signals = (overrides = {}) => ({
    preferred: new Set(),
    state: "",
    following: new Set(),
    sharingFollowing: [],
    typicalPriceNaira: null,
    lovedCategories: new Set(),
    ...overrides,
  });

  test("no signals, no score: a number made of nothing would be a guess", () => {
    expect(scoreMatch({ event: { categoryIds: [], isPaid: true, ticketPriceNaira: 5000 }, signals: signals() })).toEqual({
      score: null,
      reasons: [],
    });
  });

  test("every point comes with its reason", () => {
    const match = scoreMatch({
      event: { categoryIds: ["c1"], organizerUserId: "host", state: "Lagos", isPaid: true, ticketPriceNaira: 8000 },
      signals: signals({ preferred: new Set(["c1"]), following: new Set(["host"]), state: "lagos", typicalPriceNaira: 10000 }),
      friends: [{ _id: "f1" }, { _id: "f2" }],
    });
    expect(match.score).toBeGreaterThan(70);
    expect(match.score).toBeLessThanOrEqual(99);
    expect(match.reasons).toEqual(
      expect.arrayContaining(["One of your scenes", "A host you follow", "2 friends are going", "In your city", "Around what you usually pay"]),
    );
  });
});

test("the weekend is Friday to Sunday, and drops days already over", () => {
  // Wednesday 10:00 in Lagos.
  const wednesday = new Date(Date.UTC(2026, 9, 21, 9));
  expect(weekendDays(wednesday).map((day) => day.toISOString())).toEqual([
    "2026-10-22T23:00:00.000Z",
    "2026-10-23T23:00:00.000Z",
    "2026-10-24T23:00:00.000Z",
  ]);
  // Sunday 10:00: only Sunday is left.
  const sunday = new Date(Date.UTC(2026, 9, 25, 9));
  expect(weekendDays(sunday)).toHaveLength(1);
});

test("trending ranks by tickets sold in the last 24 hours only", async () => {
  const me = await createUser();
  const host = await createUser();
  const buyers = await Promise.all([createUser(), createUser(), createUser()]);
  const hot = await upcoming(host._id, { name: "Hot" });
  const warm = await upcoming(host._id, { name: "Warm" });
  const old = await upcoming(host._id, { name: "Old" });

  await createPaidTicket({ event: hot, buyerUserId: buyers[0]._id, quantity: 3, paidAt: new Date() });
  await createPaidTicket({ event: warm, buyerUserId: buyers[1]._id, quantity: 1, paidAt: new Date() });
  await createPaidTicket({ event: old, buyerUserId: buyers[2]._id, quantity: 9, paidAt: new Date(Date.now() - 48 * HOUR) });

  const res = await request(app).get("/api/events/discover/trending").set("Authorization", auth(me));
  expect(res.status).toBe(200);
  expect(res.body.data.items.map((item) => item.name)).toEqual(["Hot", "Warm"]);
  expect(res.body.data.items[0]).toMatchObject({ rank: 1, soldLast24h: 3 });
});

test("friends going only counts friends who share their activity", async () => {
  const me = await createUser();
  const host = await createUser();
  const sharer = await createUser({ fullName: "Chidi" });
  const private_ = await createUser({ fullName: "Hidden" });
  await User.updateOne({ _id: private_._id }, { $set: { "preferences.shareActivityWithFollowers": false } });
  await Follow.create([
    { followerUserId: me._id, followingUserId: sharer._id },
    { followerUserId: me._id, followingUserId: private_._id },
  ]);
  const party = await upcoming(host._id, { name: "Party" });
  await createPaidTicket({ event: party, buyerUserId: sharer._id });
  await createPaidTicket({ event: party, buyerUserId: private_._id });

  const res = await request(app).get("/api/events/discover/list?friendsOnly=true").set("Authorization", auth(me));
  expect(res.status).toBe(200);
  expect(res.body.data.items).toHaveLength(1);
  expect(res.body.data.items[0].friendsGoingCount).toBe(1);
  expect(res.body.data.items[0].friendsGoing.map((friend) => friend.fullName)).toEqual(["Chidi"]);
  expect(JSON.stringify(res.body.data)).not.toMatch(/Hidden/);
});

test("discover filters: free, a price ceiling, and what's running at a moment", async () => {
  const me = await createUser();
  const host = await createUser();
  await upcoming(host._id, { name: "Free one", isPaid: false, ticketPriceNaira: 0 });
  await upcoming(host._id, { name: "Cheap", ticketPriceNaira: 5000 });
  await upcoming(host._id, { name: "Pricey", ticketPriceNaira: 25000 });
  await createEvent({ organizerUserId: host._id, name: "Later", startsAt: inHours(30), endsAt: inHours(34), ticketPriceNaira: 5000 });

  const free = await request(app).get("/api/events/discover/list?free=true").set("Authorization", auth(me));
  expect(free.body.data.items.map((item) => item.name)).toEqual(["Free one"]);

  // "false" must mean false.
  const notFree = await request(app).get("/api/events/discover/list?free=false").set("Authorization", auth(me));
  expect(notFree.body.data.items.length).toBe(4);

  const under = await request(app).get("/api/events/discover/list?priceMax=10000&sort=cheapest").set("Authorization", auth(me));
  expect(under.body.data.items.map((item) => item.name)).toEqual(["Free one", "Cheap", "Later"]);

  const at = encodeURIComponent(inHours(3).toISOString());
  const running = await request(app).get(`/api/events/discover/list?runningAt=${at}`).set("Authorization", auth(me));
  expect(running.body.data.items.map((item) => item.name).sort()).toEqual(["Cheap", "Free one", "Pricey"]);
});

test("map pins: only the best are pinned, total says how many matched, and a scene match stands out", async () => {
  const scene = await makeCategory("Parties");
  const me = await createUser({ state: "Lagos" });
  await User.updateOne({ _id: me._id }, { $set: { "preferences.preferredCategoryIds": [scene._id] } });
  const host = await createUser();
  await upcoming(host._id, { name: "Best", categoryIds: [scene._id] });
  for (let index = 0; index < 4; index += 1) {
    await upcoming(host._id, { name: `Other ${index}`, latitude: 6.5 + index / 100 });
  }

  const res = await request(app)
    .get("/api/events/map/pins?lat=6.5244&lng=3.3792&radiusKm=20&limit=3&when=tonight")
    .set("Authorization", auth(me));
  expect(res.status).toBe(200);
  expect(res.body.data.total).toBe(5);
  expect(res.body.data.pinned).toBe(3);
  expect(res.body.data.pins[0]).toMatchObject({ name: "Best", kind: "top" });
  expect(res.body.data.pins[0].distanceKm).not.toBeNull();
  expect(res.body.data.timeline).toHaveLength(11);
  expect(res.body.data.pins[0]).not.toHaveProperty("description");
});

test("busiest hours come from real check-ins, and say nothing without enough of them", async () => {
  const me = await createUser();
  const host = await createUser();
  const past = await createEvent({ organizerUserId: host._id });
  const next = await upcoming(host._id);

  const quiet = await request(app).get(`/api/events/${next._id}/busiest-hours`).set("Authorization", auth(me));
  expect(quiet.body.data.peakStartHour).toBeNull();

  // 22:30 Lagos time is 21:30 UTC.
  const tenThirty = new Date(Date.UTC(2026, 5, 1, 21, 30));
  for (let index = 0; index < 12; index += 1) {
    const buyer = await createUser();
    await createPaidTicket({ event: past, buyerUserId: buyer._id, status: "used", usedAt: tenThirty });
  }

  const res = await request(app).get(`/api/events/${next._id}/busiest-hours`).set("Authorization", auth(me));
  expect(res.body.data).toMatchObject({ basis: "host", peakStartHour: 22, peakEndHour: 23, sampleSize: 12 });
});

test("home brings it together, and a new person gets 'start here' instead of picks", async () => {
  const me = await createUser({ state: "Lagos" });
  const host = await createUser();
  await upcoming(host._id, { name: "Something" });

  const res = await request(app).get("/api/events/discover/home").set("Authorization", auth(me));
  expect(res.status).toBe(200);
  expect(res.body.data.city).toBe("Lagos");
  expect(res.body.data.forYou).toEqual([]);
  expect(res.body.data.startHere.map((item) => item.name)).toEqual(["Something"]);
  expect(res.body.data).toHaveProperty("weekend");
  expect(res.body.data.nextNight).toBeNull();
});

test("people search finds names and handles, never by email, and skips blocked and deleted people", async () => {
  const UserBlock = require("../models/user-block.model");
  const me = await createUser();
  await createUser({ fullName: "Ada Obi", handle: "adaobi", email: "secret.ada@example.com" });
  const blocked = await createUser({ fullName: "Ada Blocked", handle: "adablocked" });
  const gone = await createUser({ fullName: "Ada Gone", handle: "adagone" });
  await UserBlock.create({ blockerUserId: blocked._id, blockedUserId: me._id });
  await User.updateOne({ _id: gone._id }, { $set: { deletedAt: new Date() } });

  const res = await request(app).get("/api/users/search?q=ada").set("Authorization", auth(me));
  expect(res.status).toBe(200);
  expect(res.body.data.items.map((person) => person.handle)).toEqual(["adaobi"]);
  expect(res.body.data.items[0]).not.toHaveProperty("email");

  const byEmail = await request(app).get("/api/users/search?q=secret.ada").set("Authorization", auth(me));
  expect(byEmail.body.data.items).toEqual([]);
});

test("your city includes events that never set a state, but not ones clearly elsewhere", async () => {
  const me = await createUser({ state: "Lagos" });
  const host = await createUser();
  await upcoming(host._id, { name: "In Lagos", state: "Lagos" });
  await upcoming(host._id, { name: "No state", state: "" });
  await upcoming(host._id, { name: "In Abuja", state: "FCT" });

  const res = await request(app).get("/api/events/discover/list?state=Lagos&sort=soonest").set("Authorization", auth(me));
  expect(res.body.data.items.map((item) => item.name).sort()).toEqual(["In Lagos", "No state"]);

  const home = await request(app).get("/api/events/discover/home").set("Authorization", auth(me));
  expect(home.body.data.startHere.map((item) => item.name).sort()).toEqual(["In Lagos", "No state"]);
});
