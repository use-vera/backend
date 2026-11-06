/* Going to an event together: the group, its chat, tickets sent to friends, and paying back. */

jest.mock("../services/payment-refund.service", () => ({
  ...jest.requireActual("../services/payment-refund.service"),
  returnPaystackPayment: jest.fn().mockResolvedValue({ outcome: "refunded", refund: {} }),
}));

const request = require("supertest");
const app = require("../app");
const env = require("../config/env");
const { signAccessToken } = require("../utils/jwt");
const { returnPaystackPayment } = require("../services/payment-refund.service");
const { acceptTicketTransfer } = require("../services/ticket-transfer.service");
const together = require("../services/together.service");
const DirectConversation = require("../models/direct-conversation.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const TogetherShare = require("../models/together-share.model");
const UserBlock = require("../models/user-block.model");
const Event = require("../models/event.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR = 60 * 60 * 1000;
const api = (user) => ({
  get: (path) => request(app).get(`/api/together${path}`).set("Authorization", auth(user)),
  post: (path, body = {}) => request(app).post(`/api/together${path}`).set("Authorization", auth(user)).send(body),
});

let saved;
beforeEach(() => {
  saved = { key: env.paystackSecretKey, bypass: env.paystackDevBypass };
  returnPaystackPayment.mockClear();
});
afterEach(() => {
  env.paystackSecretKey = saved.key;
  env.paystackDevBypass = saved.bypass;
});

/* An owner with two paid tickets to an upcoming event, and a friend in the group. */
const setup = async () => {
  const host = await createUser();
  const owner = await createUser({ fullName: "Ada Obi" });
  const friend = await createUser({ fullName: "Chidi Okafor" });
  const event = await createEvent({ organizerUserId: host._id, name: "Afro Night", startsAt: new Date(Date.now() + 24 * HOUR), endsAt: new Date(Date.now() + 30 * HOUR) });
  const mine = await createPaidTicket({ event, buyerUserId: owner._id });
  const spare = await createPaidTicket({ event, buyerUserId: owner._id });

  const started = await api(owner).post("/", { eventId: String(event._id) });
  expect(started.status).toBe(201);
  const groupId = started.body.data._id;
  await api(owner).post(`/${groupId}/invites`, { userIds: [String(friend._id)] }).expect(200);
  await api(friend).post(`/${groupId}/respond`, { accept: true }).expect(200);
  return { host, owner, friend, event, mine, spare, groupId };
};

const sendSpare = async ({ owner, friend, spare, groupId }, extra = {}) => {
  const res = await api(owner).post(`/${groupId}/tickets`, { ticketId: String(spare._id), toUserId: String(friend._id), ...extra });
  expect(res.status).toBe(201);
  return res.body.data.share._id;
};

const acceptSpare = async ({ friend, spare }) => {
  const share = await TogetherShare.findOne({ ticketId: spare._id, status: { $in: ["open", "on_me"] } });
  await acceptTicketTransfer({ transferId: share.transferId, actorUserId: friend._id });
  return share;
};

describe("paying back with the Paystack fee on top", () => {
  test.each([1260000, 150000, 50000000])("the buyer receives exactly the share (%i kobo)", (shareKobo) => {
    const { chargeKobo, feeKobo } = together.chargeForShare(shareKobo);
    expect(chargeKobo - feeKobo).toBe(shareKobo);
    const paystackFee = Math.min(Math.ceil(chargeKobo * 0.015) + (chargeKobo >= 250000 ? 10000 : 0), 200000);
    expect(chargeKobo - paystackFee).toBeGreaterThanOrEqual(shareKobo);
    expect(chargeKobo - paystackFee).toBeLessThanOrEqual(shareKobo + 2);
  });
});

describe("the group", () => {
  test("starting twice opens the same group, with a group chat named after the event", async () => {
    const { owner, event, groupId } = await setup();
    const again = await api(owner).post("/", { eventId: String(event._id) });
    expect(again.body.data._id).toBe(groupId);

    const conversation = await DirectConversation.findById(again.body.data.conversationId).lean();
    expect(conversation).toMatchObject({ kind: "group", title: "Afro Night", directKey: `together:${groupId}` });
    expect(conversation.participants).toHaveLength(2);
  });

  test("a two-person group chat stays a group, shows in Chats, and members can talk in it", async () => {
    const { owner, friend, groupId } = await setup();
    const group = await api(owner).get(`/${groupId}`);
    const conversationId = group.body.data.conversationId;

    const sent = await request(app)
      .post(`/api/chats/direct/${conversationId}/messages`)
      .set("Authorization", auth(friend))
      .send({ message: "can't wait" });
    expect(sent.status).toBe(201);

    /* The repair step for DMs must not have turned it into a one-to-one key. */
    const conversation = await DirectConversation.findById(conversationId).lean();
    expect(conversation.directKey).toBe(`together:${groupId}`);

    const threads = await request(app).get("/api/chats/threads").set("Authorization", auth(owner));
    const thread = threads.body.data.items.find((item) => item.conversationId === conversationId);
    expect(thread).toMatchObject({ threadType: "group", title: "Afro Night", togetherGroupId: groupId });
    expect(thread.participants).toHaveLength(2);
  });

  test("outsiders can't see the group or its chat; blocked people are never invited", async () => {
    const { owner, groupId } = await setup();
    const stranger = await createUser();
    const blocked = await createUser();
    await UserBlock.create({ blockerUserId: blocked._id, blockedUserId: owner._id });

    await api(stranger).get(`/${groupId}`).expect(404);
    const group = await api(owner).get(`/${groupId}`);
    await request(app).get(`/api/chats/direct/${group.body.data.conversationId}/messages`).set("Authorization", auth(stranger)).expect(403);

    await api(owner).post(`/${groupId}/invites`, { userIds: [String(blocked._id)] }).expect(200);
    await api(blocked).get(`/${groupId}`).expect(404);
    await api(stranger).post(`/${groupId}/invites`, { userIds: [String(stranger._id)] }).expect(403);
  });

  test("leaving takes you out of the chat", async () => {
    const { friend, groupId, owner } = await setup();
    const group = await api(owner).get(`/${groupId}`);
    await api(friend).post(`/${groupId}/leave`).expect(200);
    const conversation = await DirectConversation.findById(group.body.data.conversationId).lean();
    expect(conversation.participants.map(String)).toEqual([String(owner._id)]);
  });

  test("a weekly event whose first date has passed can still be planned, with tickets sent for the next date", async () => {
    const host = await createUser();
    const me = await createUser();
    const friend = await createUser();
    /* First night was 8 days ago; it repeats every week for two months. */
    const firstNight = new Date(Date.now() - 8 * 24 * HOUR);
    const weekly = await createEvent({
      organizerUserId: host._id,
      name: "Weekly Jam",
      startsAt: firstNight,
      endsAt: new Date(firstNight.getTime() + 3 * HOUR),
      recurrence: { type: "weekly", interval: 1, daysOfWeek: [firstNight.getDay()], endsOn: new Date(Date.now() + 60 * 24 * HOUR) },
    });
    const spare = await createPaidTicket({ event: weekly, buyerUserId: me._id });

    const started = await api(me).post("/", { eventId: String(weekly._id) });
    expect(started.status).toBe(201);
    const groupId = started.body.data._id;
    await api(me).post(`/${groupId}/invites`, { userIds: [String(friend._id)] }).expect(200);
    await api(friend).post(`/${groupId}/respond`, { accept: true }).expect(200);
    await api(me).post(`/${groupId}/tickets`, { ticketId: String(spare._id), toUserId: String(friend._id) }).expect(201);
  });

  test("no groups for an event that's over", async () => {
    const host = await createUser();
    const me = await createUser();
    const past = await createEvent({ organizerUserId: host._id });
    const res = await api(me).post("/", { eventId: String(past._id) });
    expect(res.status).toBe(409);
  });
});

describe("tickets and shares", () => {
  test("a sent ticket reads as sent, then owed once accepted, with the fee shown only to the friend", async () => {
    const context = await setup();
    await sendSpare(context);

    let view = await api(context.owner).get(`/${context.groupId}`);
    const friendRow = () => view.body.data.members.find((member) => member.user._id === String(context.friend._id));
    expect(friendRow().shares[0]).toMatchObject({ state: "sent", payment: null });

    await acceptSpare(context);
    view = await api(context.owner).get(`/${context.groupId}`);
    expect(friendRow()).toMatchObject({ hasTicket: true });
    expect(friendRow().shares[0]).toMatchObject({ state: "owed", amountNaira: Number(context.spare.totalPriceNaira), canNudge: true, payment: null });

    view = await api(context.friend).get(`/${context.groupId}`);
    const payment = friendRow().shares[0].payment;
    expect(payment.shareNaira).toBe(Number(context.spare.totalPriceNaira));
    expect(payment.totalNaira).toBeCloseTo(payment.shareNaira + payment.feeNaira, 2);
  });

  test("nudging is once a day, and only for the person owed", async () => {
    const context = await setup();
    const shareId = await sendSpare(context);
    await acceptSpare(context);

    await api(context.friend).post(`/shares/${shareId}/nudge`).expect(404);
    await api(context.owner).post(`/shares/${shareId}/nudge`).expect(200);
    await api(context.owner).post(`/shares/${shareId}/nudge`).expect(429);
  });

  test("on me: nothing to pay", async () => {
    const context = await setup();
    const shareId = await sendSpare(context, { onMe: true });
    await acceptSpare(context);
    await api(context.friend).post(`/shares/${shareId}/pay`).expect(409);
  });

  test("you can't pay for a ticket you haven't accepted", async () => {
    const context = await setup();
    const shareId = await sendSpare(context);
    const res = await api(context.friend).post(`/shares/${shareId}/pay`);
    expect(res.status).toBe(409);
    expect(res.body.error?.code || res.body.code).toBe("TICKET_NOT_ACCEPTED");
  });

  test("paying credits the owner's pending wallet once, and a cancelled event gives it all back", async () => {
    env.paystackSecretKey = "";
    env.paystackDevBypass = true;
    const context = await setup();
    const shareId = await sendSpare(context);
    await acceptSpare(context);

    const paid = await api(context.friend).post(`/shares/${shareId}/pay`);
    expect(paid.status).toBe(201);
    expect(paid.body.data.requiresPayment).toBe(false);
    await api(context.friend).post(`/shares/${shareId}/pay`).expect(409);

    const shareKobo = Math.round(Number(context.spare.totalPriceNaira) * 100);
    let wallet = await OrganizerWallet.findOne({ organizerUserId: context.owner._id }).lean();
    expect(wallet.pendingBalanceKobo).toBe(shareKobo);
    expect(wallet.availableBalanceKobo || 0).toBe(0);

    await Event.updateOne({ _id: context.event._id }, { $set: { status: "cancelled" } });
    await together.settleSharesForCancelledEvent({ eventId: context.event._id, reason: "Rain" });
    await together.settleSharesForCancelledEvent({ eventId: context.event._id, reason: "Rain" });

    expect(returnPaystackPayment).toHaveBeenCalledTimes(1);
    expect((await TogetherShare.findById(shareId)).status).toBe("refunded");
    wallet = await OrganizerWallet.findOne({ organizerUserId: context.owner._id }).lean();
    expect(wallet.pendingBalanceKobo).toBe(0);
  });

  test("the webhook path pays once; a second payment for a settled share goes back to the friend", async () => {
    const context = await setup();
    const shareId = await sendSpare(context);
    await acceptSpare(context);
    const share = await TogetherShare.findById(shareId);

    const attempt = (reference) =>
      PaymentAttempt.create({
        reference,
        provider: "paystack",
        kind: "together_share",
        buyerUserId: context.friend._id,
        eventId: context.event._id,
        togetherShareId: share._id,
        amountKobo: together.chargeForShare(share.amountKobo).chargeKobo,
        currency: "NGN",
      });

    const first = await attempt("ref_first");
    await together.finalizeSharePaymentAttempt({ paymentAttempt: first, paymentData: { amount: first.amountKobo } });
    await together.finalizeSharePaymentAttempt({ paymentAttempt: first, paymentData: { amount: first.amountKobo } });
    expect(returnPaystackPayment).not.toHaveBeenCalled();

    const second = await attempt("ref_second");
    await together.finalizeSharePaymentAttempt({ paymentAttempt: second, paymentData: { amount: second.amountKobo } });
    expect(returnPaystackPayment).toHaveBeenCalledWith({ reference: "ref_second", amountKobo: second.amountKobo });

    const wallet = await OrganizerWallet.findOne({ organizerUserId: context.owner._id }).lean();
    expect(wallet.pendingBalanceKobo).toBe(share.amountKobo);
  });

  test("only joined members can be sent a ticket", async () => {
    const { owner, spare, groupId } = await setup();
    const invitee = await createUser();
    await api(owner).post(`/${groupId}/invites`, { userIds: [String(invitee._id)] }).expect(200);
    const res = await api(owner).post(`/${groupId}/tickets`, { ticketId: String(spare._id), toUserId: String(invitee._id) });
    expect(res.status).toBe(409);
  });
});
