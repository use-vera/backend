const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const Follow = require("../models/follow.model");
const UserBlock = require("../models/user-block.model");
const User = require("../models/user.model");
const DeviceToken = require("../models/device-token.model");
const AppNotification = require("../models/notification.model");
const { createNotification } = require("../services/notification.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR = 60 * 60 * 1000;
const future = (hours) => new Date(Date.now() + hours * HOUR);

describe("notification switches", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: [{ status: "ok" }] }),
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  test("default on, saved per topic, and unknown topics are refused", async () => {
    const me = await createUser();

    const initial = await request(app).get("/api/users/me/preferences").set("Authorization", auth(me));
    expect(initial.body.data.notifications).toEqual({
      reminders: true,
      resaleOffers: true,
      eventChat: true,
      followersAndMessages: true,
      watches: true,
    });

    const updated = await request(app)
      .patch("/api/users/me/preferences")
      .set("Authorization", auth(me))
      .send({ notifications: { resaleOffers: false } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.notifications.resaleOffers).toBe(false);
    expect(updated.body.data.notifications.reminders).toBe(true);

    // Changes to your events can't be switched off, so there's no key for it.
    const locked = await request(app)
      .patch("/api/users/me/preferences")
      .set("Authorization", auth(me))
      .send({ notifications: { eventChanges: false } });
    expect(locked.status).toBe(400);
  });

  test("a muted topic skips the push but keeps the inbox entry; always-on types still push", async () => {
    const me = await createUser();
    await DeviceToken.create({ userId: me._id, pushToken: "ExponentPushToken[test-token]", platform: "ios" });
    await User.updateOne({ _id: me._id }, { $set: { "preferences.notifications.followersAndMessages": false } });

    await createNotification({ userId: me._id, type: "user.followed", title: "Ada", message: "started following you" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await AppNotification.countDocuments({ userId: me._id, type: "user.followed" })).toBe(1);

    await createNotification({ userId: me._id, type: "ticket.refunded", title: "Refund", message: "Your refund is on its way" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("saved events", () => {
  test("save, list by upcoming and past, unsave; idempotent and private drafts stay private", async () => {
    const me = await createUser();
    const host = await createUser();
    const soon = await createEvent({ organizerUserId: host._id, startsAt: future(24), endsAt: future(28), name: "Soon" });
    const gone = await createEvent({ organizerUserId: host._id, name: "Gone" });
    const draft = await createEvent({ organizerUserId: host._id, status: "draft", startsAt: future(24), endsAt: future(28) });

    for (const event of [soon, gone, soon]) {
      const saved = await request(app).post(`/api/events/${event._id}/save`).set("Authorization", auth(me));
      expect(saved.status).toBe(200);
    }

    const hidden = await request(app).post(`/api/events/${draft._id}/save`).set("Authorization", auth(me));
    expect(hidden.status).toBe(404);

    const ids = await request(app).get("/api/events/saved/ids").set("Authorization", auth(me));
    expect(ids.body.data.eventIds.sort()).toEqual([String(soon._id), String(gone._id)].sort());

    const upcoming = await request(app).get("/api/events/saved?scope=upcoming").set("Authorization", auth(me));
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.data.items.map((event) => event.name)).toEqual(["Soon"]);
    expect(upcoming.body.data.counts).toEqual({ upcoming: 1, past: 1 });

    const past = await request(app).get("/api/events/saved?scope=past").set("Authorization", auth(me));
    expect(past.body.data.items.map((event) => event.name)).toEqual(["Gone"]);

    await request(app).delete(`/api/events/${soon._id}/save`).set("Authorization", auth(me)).expect(200);
    const after = await request(app).get("/api/events/saved/ids").set("Authorization", auth(me));
    expect(after.body.data.eventIds).toEqual([String(gone._id)]);

    // Someone else's saves are their own.
    const other = await createUser();
    const theirs = await request(app).get("/api/events/saved/ids").set("Authorization", auth(other));
    expect(theirs.body.data.eventIds).toEqual([]);
  });

  test("importing the phone's old list skips junk and drafts", async () => {
    const me = await createUser();
    const host = await createUser();
    const real = await createEvent({ organizerUserId: host._id });
    const draft = await createEvent({ organizerUserId: host._id, status: "draft" });

    const imported = await request(app)
      .post("/api/events/saved/import")
      .set("Authorization", auth(me))
      .send({ eventIds: [String(real._id), String(real._id), String(draft._id), "not-an-id", "0123456789abcdef01234567"] });
    expect(imported.status).toBe(200);
    expect(imported.body.data.imported).toBe(1);

    const ids = await request(app).get("/api/events/saved/ids").set("Authorization", auth(me));
    expect(ids.body.data.eventIds).toEqual([String(real._id)]);
  });
});

describe("public profile by handle", () => {
  const setup = async ({ sharing = true } = {}) => {
    const ada = await createUser({ fullName: "Ada Obi", handle: "adaobi" });
    if (!sharing) {
      await User.updateOne({ _id: ada._id }, { $set: { "preferences.shareActivityWithFollowers": false } });
    }
    const host = await createUser();
    const upcoming = await createEvent({ organizerUserId: host._id, startsAt: future(24), endsAt: future(28), name: "Rooftop" });
    const past = await createEvent({ organizerUserId: host._id, name: "Afrobeats Night" });
    await createPaidTicket({ event: upcoming, buyerUserId: ada._id });
    await createPaidTicket({ event: past, buyerUserId: ada._id, status: "used", usedAt: new Date(Date.now() - HOUR) });
    return { ada };
  };

  test("unknown handles are a 404", async () => {
    const me = await createUser();
    const res = await request(app).get("/api/users/by-handle/nobody-here").set("Authorization", auth(me));
    expect(res.status).toBe(404);
    expect(res.body.error?.code || res.body.code).toBe("USER_NOT_FOUND");
  });

  test("followers see activity while sharing is on; strangers never do", async () => {
    const { ada } = await setup();
    const stranger = await createUser();
    const follower = await createUser();
    await Follow.create({ followerUserId: follower._id, followingUserId: ada._id });

    const asStranger = await request(app).get("/api/users/by-handle/@AdaObi").set("Authorization", auth(stranger));
    expect(asStranger.status).toBe(200);
    expect(asStranger.body.data.user.fullName).toBe("Ada Obi");
    expect(asStranger.body.data.user.email).toBeUndefined();
    expect(asStranger.body.data.activity.visible).toBe(false);
    expect(asStranger.body.data.activity.going).toEqual([]);
    expect(asStranger.body.data.activity.beenToCount).toBeNull();

    const asFollower = await request(app).get("/api/users/by-handle/adaobi").set("Authorization", auth(follower));
    expect(asFollower.body.data.isFollowing).toBe(true);
    expect(asFollower.body.data.activity.going.map((event) => event.name)).toEqual(["Rooftop"]);
    expect(asFollower.body.data.activity.beenToCount).toBe(1);
  });

  test("with sharing off, followers see nothing but Ada still sees her own", async () => {
    const { ada } = await setup({ sharing: false });
    const follower = await createUser();
    await Follow.create({ followerUserId: follower._id, followingUserId: ada._id });

    const asFollower = await request(app).get("/api/users/by-handle/adaobi").set("Authorization", auth(follower));
    expect(asFollower.body.data.activity.visible).toBe(false);
    expect(asFollower.body.data.activity.sharing).toBe(false);
    expect(asFollower.body.data.activity.going).toEqual([]);

    const asAda = await request(app).get("/api/users/by-handle/adaobi").set("Authorization", auth(ada));
    expect(asAda.body.data.isMe).toBe(true);
    expect(asAda.body.data.activity.visible).toBe(true);
    expect(asAda.body.data.activity.going).toHaveLength(1);
  });

  test("mutuals are people you follow who follow them", async () => {
    const ada = await createUser({ handle: "ada2" });
    const me = await createUser();
    const chidi = await createUser({ fullName: "Chidi" });
    const tola = await createUser({ fullName: "Tola" });
    await Follow.create([
      { followerUserId: me._id, followingUserId: chidi._id },
      { followerUserId: chidi._id, followingUserId: ada._id },
      { followerUserId: tola._id, followingUserId: ada._id },
    ]);

    const res = await request(app).get("/api/users/by-handle/ada2").set("Authorization", auth(me));
    expect(res.body.data.mutuals).toEqual({ count: 1, names: ["Chidi"] });
    expect(res.body.data.followersCount).toBe(2);
  });
});

describe("public profile by id and hosting", () => {
  test("by-id returns the same profile as by-handle; unknown and malformed ids are refused", async () => {
    const ada = await createUser({ fullName: "Ada Obi", handle: "adaid" });
    const me = await createUser();

    const byId = await request(app).get(`/api/users/by-id/${ada._id}`).set("Authorization", auth(me));
    const byHandle = await request(app).get("/api/users/by-handle/adaid").set("Authorization", auth(me));
    expect(byId.status).toBe(200);
    expect(byId.body.data).toEqual(byHandle.body.data);

    const unknown = await request(app).get(`/api/users/by-id/${new mongoose.Types.ObjectId()}`).set("Authorization", auth(me));
    expect(unknown.status).toBe(404);

    const malformed = await request(app).get("/api/users/by-id/not-an-id").set("Authorization", auth(me));
    expect(malformed.status).toBe(400);
  });

  test("hosting lists upcoming published events to anyone, not drafts or past ones", async () => {
    const host = await createUser({ handle: "hostlady" });
    const stranger = await createUser();
    await createEvent({ organizerUserId: host._id, startsAt: future(48), endsAt: future(52), name: "Later" });
    await createEvent({ organizerUserId: host._id, startsAt: future(24), endsAt: future(28), name: "Sooner" });
    await createEvent({ organizerUserId: host._id, name: "Over" });
    await createEvent({ organizerUserId: host._id, status: "draft", startsAt: future(24), endsAt: future(28), name: "Secret" });

    const res = await request(app).get(`/api/users/by-id/${host._id}`).set("Authorization", auth(stranger));
    expect(res.body.data.activity.visible).toBe(false);
    expect(res.body.data.hosting.map((event) => event.name)).toEqual(["Sooner", "Later"]);
  });

  test("blocked either way: by them is a 404, by you shows no hosting", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, startsAt: future(24), endsAt: future(28) });

    await UserBlock.create({ blockerUserId: me._id, blockedUserId: host._id });
    const iBlocked = await request(app).get(`/api/users/by-id/${host._id}`).set("Authorization", auth(me));
    expect(iBlocked.body.data.blockedByYou).toBe(true);
    expect(iBlocked.body.data.hosting).toEqual([]);

    const theyBlocked = await request(app).get(`/api/users/by-id/${me._id}`).set("Authorization", auth(host));
    expect(theyBlocked.status).toBe(404);
  });
});

describe("year recap", () => {
  test("counts each event once, by Lagos month, with distinct hosts", async () => {
    const me = await createUser();
    const hostA = await createUser();
    const hostB = await createUser();
    const year = new Date().getUTCFullYear() - 1;
    /* 23:30 UTC on 31 Jan is already February in Lagos. */
    const lateJan = new Date(Date.UTC(year, 0, 31, 23, 30));
    const march = new Date(Date.UTC(year, 2, 10, 20));

    const one = await createEvent({ organizerUserId: hostA._id, address: "A" });
    const two = await createEvent({ organizerUserId: hostB._id, address: "B" });
    const outside = await createEvent({ organizerUserId: hostB._id });
    await createPaidTicket({ event: one, buyerUserId: me._id, status: "used", usedAt: lateJan });
    await createPaidTicket({ event: one, buyerUserId: me._id, status: "used", usedAt: march });
    await createPaidTicket({ event: two, buyerUserId: me._id, status: "used", usedAt: march });
    await createPaidTicket({ event: outside, buyerUserId: me._id, status: "used", usedAt: new Date(Date.UTC(year - 1, 5, 1)) });

    const res = await request(app).get(`/api/users/me/recap?year=${year}`).set("Authorization", auth(me));
    expect(res.status).toBe(200);
    expect(res.body.data.nights).toBe(2);
    expect(res.body.data.hosts).toBe(2);
    expect(res.body.data.places).toBe(2);
    expect(res.body.data.months[1]).toBe(1);
    expect(res.body.data.months[2]).toBe(1);
    expect(res.body.data.months[0]).toBe(0);
    expect(res.body.data.monthsSoFar).toBe(12);
  });
});
