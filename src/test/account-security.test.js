/* Phase 5c: signed-in devices, changing your sign-in email, and blocking. */

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  sendEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  dispatchEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");
const app = require("../app");
const { sendEmail, dispatchEmail } = require("../services/email.service");
const { signAccessToken, signRefreshToken } = require("../utils/jwt");
const { hashRefreshToken, createSession } = require("../services/session.service");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const UserSession = require("../models/user-session.model");
const { createUser } = require("./fixtures");

const lastSentCode = () => sendEmail.mock.calls.at(-1)[0].subject.match(/^(\d{6})/)[1];
const bearer = (token) => `Bearer ${token}`;
const legacyAuth = (user) => bearer(signAccessToken({ userId: String(user._id) }));

/* Signs in on a "device" the way the app does: request a code, enter it.
   Used once; the per-IP code limit would trip if every test did it. */
const signInWithCode = async (email, device) => {
  await UserSession.db.collection("emailotps").deleteMany({ email });
  await request(app).post("/api/auth/code/request").send({ email }).expect(200);
  const res = await request(app).post("/api/auth/code/verify").send({ email, code: lastSentCode(), device });
  expect(res.status).toBe(200);
  return res.body.data;
};

/* A signed-in device, made the way every sign-in makes one. */
const signIn = async (email, device) => {
  const user = await User.findOne({ email });
  return createSession({ userId: user._id, context: { device } });
};

beforeEach(() => {
  sendEmail.mockClear();
  dispatchEmail.mockClear();
});

describe("signed-in devices", () => {
  test("each sign-in is its own device; signing in again doesn't sign the first out", async () => {
    const user = await createUser({ email: "two.phones@example.com" });
    const phone = await signInWithCode(user.email, { name: "iPhone 15", platform: "ios" });
    const laptop = await signIn(user.email, { name: "Chrome on Mac", platform: "web" });

    // Both still work, including refreshing the first.
    await request(app).get("/api/auth/me").set("Authorization", bearer(phone.token)).expect(200);
    await request(app).get("/api/auth/me").set("Authorization", bearer(laptop.token)).expect(200);
    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: phone.refreshToken });
    expect(refreshed.status).toBe(200);

    // The old refresh token is spent once it's been swapped.
    const replay = await request(app).post("/api/auth/refresh").send({ refreshToken: phone.refreshToken });
    expect(replay.status).toBe(401);

    const list = await request(app).get("/api/auth/sessions").set("Authorization", bearer(refreshed.body.data.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(2);
    const current = list.body.data.items.find((item) => item.isCurrent);
    expect(current.deviceName).toBe("iPhone 15");
    expect(JSON.stringify(list.body.data)).not.toMatch(/refreshTokenHash|lastIp/);
  });

  test("signing a device out stops its tokens at once", async () => {
    const user = await createUser({ email: "lost.phone@example.com" });
    const phone = await signIn(user.email, { name: "Lost phone", platform: "android" });
    const laptop = await signIn(user.email, { name: "Laptop", platform: "web" });

    const list = await request(app).get("/api/auth/sessions").set("Authorization", bearer(laptop.token));
    const lost = list.body.data.items.find((item) => item.deviceName === "Lost phone");

    await request(app).delete(`/api/auth/sessions/${lost._id}`).set("Authorization", bearer(laptop.token)).expect(200);

    const blocked = await request(app).get("/api/auth/me").set("Authorization", bearer(phone.token));
    expect(blocked.status).toBe(401);
    expect(blocked.body.error?.code || blocked.body.code).toBe("SESSION_REVOKED");
    await request(app).post("/api/auth/refresh").send({ refreshToken: phone.refreshToken }).expect(401);

    // Someone else's device can't be signed out from your account.
    const stranger = await createUser({ email: "stranger@example.com" });
    const theirs = await signIn(stranger.email, { name: "Theirs" });
    const theirList = await request(app).get("/api/auth/sessions").set("Authorization", bearer(theirs.token));
    await request(app)
      .delete(`/api/auth/sessions/${theirList.body.data.items[0]._id}`)
      .set("Authorization", bearer(laptop.token))
      .expect(404);
  });

  test("sign out everywhere else keeps this device only", async () => {
    const user = await createUser({ email: "everywhere@example.com" });
    const a = await signIn(user.email, { name: "A" });
    const b = await signIn(user.email, { name: "B" });
    const c = await signIn(user.email, { name: "C" });

    const res = await request(app).post("/api/auth/sessions/sign-out-others").set("Authorization", bearer(c.token));
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(2);

    await request(app).get("/api/auth/me").set("Authorization", bearer(a.token)).expect(401);
    await request(app).get("/api/auth/me").set("Authorization", bearer(b.token)).expect(401);
    await request(app).get("/api/auth/me").set("Authorization", bearer(c.token)).expect(200);

    // A device on a refresh token from before sessions is cut off too.
    const legacyRefresh = signRefreshToken({ userId: String(user._id) });
    await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash: hashRefreshToken(legacyRefresh) } });
    await request(app).post("/api/auth/sessions/sign-out-others").set("Authorization", bearer(c.token)).expect(200);
    await request(app).post("/api/auth/refresh").send({ refreshToken: legacyRefresh }).expect(401);

    // A token from before sessions can't say which device it is, so it can't do this.
    await request(app).post("/api/auth/sessions/sign-out-others").set("Authorization", legacyAuth(user)).expect(409);
  });

  test("logging out ends that device's session", async () => {
    const user = await createUser({ email: "logout@example.com" });
    const phone = await signIn(user.email, { name: "Phone" });

    const out = await request(app).post("/api/auth/logout").send({ refreshToken: phone.refreshToken });
    expect(out.body.data.revoked).toBe(true);
    await request(app).get("/api/auth/me").set("Authorization", bearer(phone.token)).expect(401);
  });

  test("a refresh token from before sessions still works once, and moves onto a session", async () => {
    const user = await createUser({ email: "legacy@example.com" });
    const legacyRefresh = signRefreshToken({ userId: String(user._id) });
    await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash: hashRefreshToken(legacyRefresh) } });

    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: legacyRefresh });
    expect(res.status).toBe(200);
    expect(await UserSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(1);

    await request(app).post("/api/auth/refresh").send({ refreshToken: legacyRefresh }).expect(401);
  });
});

describe("changing your sign-in email", () => {
  test("the code goes to the new address; confirming signs other devices out and tells the old address", async () => {
    const user = await createUser({ email: "old.address@example.com" });
    const phone = await signIn(user.email, { name: "Phone" });
    const other = await signIn(user.email, { name: "Other" });

    const asked = await request(app)
      .post("/api/users/me/email/change")
      .set("Authorization", bearer(phone.token))
      .send({ email: "New.Address@Example.com" });
    expect(asked.status).toBe(200);
    expect(sendEmail.mock.calls.at(-1)[0].to).toBe("new.address@example.com");
    expect(sendEmail.mock.calls.at(-1)[0].subject).toMatch(/confirms your new Vera email/);

    // Not changed until the code comes back.
    expect((await User.findById(user._id)).email).toBe("old.address@example.com");

    const wrong = await request(app)
      .post("/api/users/me/email/confirm")
      .set("Authorization", bearer(phone.token))
      .send({ code: lastSentCode() === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);

    const confirmed = await request(app)
      .post("/api/users/me/email/confirm")
      .set("Authorization", bearer(phone.token))
      .send({ code: lastSentCode() });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.email).toBe("new.address@example.com");
    expect(confirmed.body.data.otherDevicesSignedOut).toBe(1);

    expect((await User.findById(user._id)).email).toBe("new.address@example.com");
    await request(app).get("/api/auth/me").set("Authorization", bearer(phone.token)).expect(200);
    await request(app).get("/api/auth/me").set("Authorization", bearer(other.token)).expect(401);
    expect(dispatchEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "old.address@example.com" }));
  });

  test("an address another account uses, or your own, is refused", async () => {
    const user = await createUser({ email: "mine@example.com" });
    await createUser({ email: "taken@example.com" });

    const taken = await request(app)
      .post("/api/users/me/email/change")
      .set("Authorization", legacyAuth(user))
      .send({ email: "taken@example.com" });
    expect(taken.status).toBe(409);

    const same = await request(app)
      .post("/api/users/me/email/change")
      .set("Authorization", legacyAuth(user))
      .send({ email: "MINE@example.com" });
    expect(same.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("confirming with nothing pending is refused", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/api/users/me/email/confirm")
      .set("Authorization", legacyAuth(user))
      .send({ code: "123456" });
    expect(res.status).toBe(400);
  });
});

describe("blocking", () => {
  test("blocking ends follows both ways and stops following, messaging and the profile", async () => {
    const me = await createUser({ handle: "blocker" });
    const them = await createUser({ handle: "blockee" });
    await Follow.create([
      { followerUserId: me._id, followingUserId: them._id },
      { followerUserId: them._id, followingUserId: me._id },
    ]);

    await request(app).post(`/api/users/${them._id}/block`).set("Authorization", legacyAuth(me)).expect(200);
    expect(await Follow.countDocuments({})).toBe(0);

    // They can't follow, message, or find me.
    await request(app).post(`/api/follows/${me._id}`).set("Authorization", legacyAuth(them)).expect(404);
    await request(app)
      .post("/api/chats/direct")
      .set("Authorization", legacyAuth(them))
      .send({ recipientUserId: String(me._id) })
      .expect(403);
    await request(app).get("/api/users/by-handle/blocker").set("Authorization", legacyAuth(them)).expect(404);

    // I can still see enough to unblock them.
    const mine = await request(app).get("/api/users/by-handle/blockee").set("Authorization", legacyAuth(me));
    expect(mine.status).toBe(200);
    expect(mine.body.data.blockedByYou).toBe(true);
    expect(mine.body.data.activity.visible).toBe(false);

    const list = await request(app).get("/api/users/me/blocks").set("Authorization", legacyAuth(me));
    expect(list.body.data.items.map((item) => item.handle)).toEqual(["blockee"]);

    await request(app).delete(`/api/users/${them._id}/block`).set("Authorization", legacyAuth(me)).expect(200);
    await request(app).post(`/api/follows/${me._id}`).set("Authorization", legacyAuth(them)).expect(200);
  });

  test("you can't block yourself", async () => {
    const me = await createUser();
    await request(app).post(`/api/users/${me._id}/block`).set("Authorization", legacyAuth(me)).expect(400);
  });
});
