/* Phase 5d: deleting your account. */

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  sendEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  dispatchEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");
const app = require("../app");
const { sendEmail } = require("../services/email.service");
const { signAccessToken } = require("../utils/jwt");
const { createSession } = require("../services/session.service");
const { purgeDeletedAccounts } = require("../services/account-deletion.service");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const EventTicket = require("../models/event-ticket.model");
const AppNotification = require("../models/notification.model");
const UserSession = require("../models/user-session.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR = 60 * 60 * 1000;
const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const lastSentCode = () => sendEmail.mock.calls.at(-1)[0].subject.match(/^(\d{6})/)[1];

beforeEach(() => sendEmail.mockClear());

test("upcoming tickets and money in the wallet block deleting, and say what to do", async () => {
  const me = await createUser();
  const host = await createUser();
  const soon = await createEvent({
    organizerUserId: host._id,
    startsAt: new Date(Date.now() + 24 * HOUR),
    endsAt: new Date(Date.now() + 28 * HOUR),
  });
  const over = await createEvent({ organizerUserId: host._id });
  await createPaidTicket({ event: soon, buyerUserId: me._id, quantity: 2 });
  await createPaidTicket({ event: over, buyerUserId: me._id });
  await OrganizerWallet.create({ organizerUserId: me._id, availableBalanceKobo: 1260000, pendingBalanceKobo: 0 });

  const check = await request(app).get("/api/users/me/deletion-check").set("Authorization", auth(me));
  expect(check.status).toBe(200);
  expect(check.body.data.canDelete).toBe(false);
  const codes = Object.fromEntries(check.body.data.blockers.map((blocker) => [blocker.code, blocker]));
  // Only the event still to come counts.
  expect(codes.UPCOMING_TICKETS.count).toBe(2);
  expect(codes.WALLET_AVAILABLE.amountKobo).toBe(1260000);
  expect(check.body.data.eraseWithinDays).toBe(30);

  // No code is even sent while something's in the way.
  const code = await request(app).post("/api/users/me/delete/code").set("Authorization", auth(me));
  expect(code.status).toBe(409);
  expect(sendEmail).not.toHaveBeenCalled();
});

test("hosting an upcoming event blocks deleting", async () => {
  const me = await createUser();
  await createEvent({
    organizerUserId: me._id,
    startsAt: new Date(Date.now() + 24 * HOUR),
    endsAt: new Date(Date.now() + 28 * HOUR),
  });

  const check = await request(app).get("/api/users/me/deletion-check").set("Authorization", auth(me));
  expect(check.body.data.blockers.map((blocker) => blocker.code)).toContain("HOSTING");
});

test("with nothing in the way, the emailed code deletes the account and everything personal goes", async () => {
  const me = await createUser({ email: "leaving@example.com", fullName: "Ada Obi", handle: "adaleaving", bio: "hi" });
  const friend = await createUser();
  const host = await createUser();
  const past = await createEvent({ organizerUserId: host._id });
  const ticket = await createPaidTicket({ event: past, buyerUserId: me._id, status: "used", usedAt: new Date(Date.now() - HOUR) });
  await Follow.create([
    { followerUserId: me._id, followingUserId: friend._id },
    { followerUserId: friend._id, followingUserId: me._id },
  ]);
  await AppNotification.create({ userId: me._id, type: "user.followed", title: "x", message: "y" });
  const device = await createSession({ userId: me._id, context: { device: { name: "Phone" } } });

  const check = await request(app).get("/api/users/me/deletion-check").set("Authorization", auth(me));
  expect(check.body.data.canDelete).toBe(true);

  await request(app).post("/api/users/me/delete/code").set("Authorization", auth(me)).expect(200);
  expect(sendEmail.mock.calls.at(-1)[0].to).toBe("leaving@example.com");
  expect(sendEmail.mock.calls.at(-1)[0].subject).toMatch(/deleting your Vera account/);

  const wrong = await request(app)
    .post("/api/users/me/delete")
    .set("Authorization", auth(me))
    .send({ code: lastSentCode() === "000000" ? "111111" : "000000" });
  expect(wrong.status).toBe(400);
  expect((await User.findById(me._id)).deletedAt).toBeNull();

  const deleted = await request(app).post("/api/users/me/delete").set("Authorization", auth(me)).send({ code: lastSentCode() });
  expect(deleted.status).toBe(200);

  const after = await User.findById(me._id).lean();
  expect(after.deletedAt).toBeTruthy();
  expect(after.fullName).toBe("Deleted user");
  expect(after.email).not.toBe("leaving@example.com");
  expect(after.handle).toBeUndefined();
  expect(after.bio).toBe("");
  expect(await Follow.countDocuments({})).toBe(0);

  // Every token stops working, old-style ones included.
  await request(app).get("/api/auth/me").set("Authorization", `Bearer ${device.token}`).expect(401);
  await request(app).get("/api/auth/me").set("Authorization", auth(me)).expect(401);

  // The address is free to sign up with again.
  await request(app).post("/api/auth/code/request").send({ email: "leaving@example.com" }).expect(200);

  await purgeDeletedAccounts();
  expect(await AppNotification.countDocuments({ userId: me._id })).toBe(0);
  expect(await UserSession.countDocuments({ userId: me._id })).toBe(0);
  expect((await User.findById(me._id)).purgedAt).toBeTruthy();

  // The receipt is kept, without who it was.
  const kept = await EventTicket.findById(ticket._id).lean();
  expect(kept).toBeTruthy();
  expect(kept.totalPriceNaira).toBeGreaterThan(0);
  expect(kept.attendeeEmail).toBe("");
  expect(kept.attendeeName).toBe("");
});
