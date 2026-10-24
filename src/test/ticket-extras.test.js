/* Phase 4: receipts, sending a ticket to a friend, and waitlists. */

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  sendEmail: jest.fn().mockResolvedValue({ id: "mock" }),
  dispatchEmail: jest.fn().mockResolvedValue({ id: "mock" }),
}));

const crypto = require("crypto");
const mongoose = require("mongoose");
const { sendEmail, dispatchEmail } = require("../services/email.service");
const { getTicketReceipt, emailTicketReceipt } = require("../services/receipt.service");
const {
  createTicketTransfer,
  cancelTicketTransfer,
  listIncomingTransfers,
  getTransferByToken,
  acceptTicketTransfer,
  declineTicketTransfer,
} = require("../services/ticket-transfer.service");
const { joinWaitlist, leaveWaitlist, getMyWaitlistStatus, processWaitlists, NOTIFIED_HOLD_MS } = require("../services/event-waitlist.service");
const { createTicketResale } = require("../services/event.service");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const TicketTransfer = require("../models/ticket-transfer.model");
const EventWaitlistEntry = require("../models/event-waitlist-entry.model");
const Notification = require("../models/notification.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const upcoming = (organizerUserId, overrides = {}) =>
  createEvent({
    organizerUserId,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 52 * HOUR_MS),
    ...overrides,
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("receipts", () => {
  const paidOrder = async ({ feeMode = "passed_to_attendee" } = {}) => {
    const organizer = await createUser({ fullName: "Gidi Vibes" });
    const buyer = await createUser({ fullName: "Ada Obi" });
    const event = await upcoming(organizer._id, { feeMode });
    const ticket = await createPaidTicket({ event, buyerUserId: buyer._id, feeMode });
    await PaymentAttempt.create({
      reference: ticket.paymentReference,
      provider: "paystack",
      kind: "ticket_purchase",
      status: "success",
      buyerUserId: buyer._id,
      eventId: event._id,
      ticketId: ticket._id,
      amountKobo: Math.round(ticket.totalPriceNaira * 100),
      fulfillmentStatus: "done",
      fulfilledAt: new Date(),
      paystackVerifyPayload: { authorization: { card_type: "visa", last4: "4421", bank: "GTBank", channel: "card" } },
    });
    return { organizer, buyer, event, ticket };
  };

  test("adds up to what was charged, with the fee on its own line", async () => {
    const { buyer, ticket } = await paidOrder();

    const receipt = await getTicketReceipt({ ticketId: ticket._id, actorUserId: buyer._id });

    expect(receipt.totalNaira).toBe(ticket.totalPriceNaira);
    expect(receipt.lines.reduce((sum, line) => sum + line.amountNaira, 0)).toBe(ticket.totalPriceNaira);
    expect(receipt.lines.find((line) => line.kind === "fee").amountNaira).toBeGreaterThan(0);
    expect(receipt.method).toMatchObject({ last4: "4421" });
    expect(receipt.billedTo.name).toBe("Ada Obi");
  });

  test("someone who didn't pay can't see it", async () => {
    const { ticket } = await paidOrder();
    const stranger = await createUser();

    await expect(getTicketReceipt({ ticketId: ticket._id, actorUserId: stranger._id })).rejects.toMatchObject({
      code: "RECEIPT_NOT_YOURS",
    });
  });

  test("emails only the payer's own address", async () => {
    const { buyer, ticket } = await paidOrder();

    const result = await emailTicketReceipt({ ticketId: ticket._id, actorUserId: buyer._id });

    expect(result.sentTo).toBe(buyer.email);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: buyer.email }));
  });
});

describe("sending a ticket", () => {
  const heldTicket = async (eventOverrides = {}) => {
    const organizer = await createUser();
    const sender = await createUser({ fullName: "Ada Obi" });
    const event = await upcoming(organizer._id, eventOverrides);
    const ticket = await createPaidTicket({ event, buyerUserId: sender._id });
    return { sender, event, ticket };
  };

  test("to someone on Vera: they accept and get it with a fresh code", async () => {
    const { sender, ticket } = await heldTicket();
    const friend = await createUser({ fullName: "Tola Adeyemi", handle: "tola" });
    await EventAddOnPurchase.create({
      eventId: ticket.eventId,
      ticketId: ticket._id,
      buyerUserId: sender._id,
      organizerUserId: ticket.organizerUserId,
      addOnId: new mongoose.Types.ObjectId(),
      name: "Drink voucher",
      redemption: "desk",
      unitPriceNaira: 2000,
      quantity: 1,
      status: "paid",
    });

    const transfer = await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "@tola" } });
    expect((await listIncomingTransfers({ actorUserId: friend._id })).items).toHaveLength(1);

    await acceptTicketTransfer({ transferId: transfer._id, actorUserId: friend._id });

    const moved = await EventTicket.findById(ticket._id);
    expect(String(moved.buyerUserId)).toBe(String(friend._id));
    expect(moved.ticketCode).not.toBe(ticket.ticketCode);
    expect(moved.attendeeName).toBe("Tola Adeyemi");
    const addOn = await EventAddOnPurchase.findOne({ ticketId: ticket._id });
    expect(String(addOn.buyerUserId)).toBe(String(friend._id));
  });

  test("to an email: only someone signed in with that email can accept", async () => {
    const { sender, ticket } = await heldTicket();
    await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "Newbie@Example.com" } });
    const emailed = dispatchEmail.mock.calls[0][0];
    expect(emailed.to).toBe("newbie@example.com");
    const token = decodeURIComponent(emailed.text.match(/claim\/([A-Za-z0-9_%-]+)/)[1]);

    const someoneElse = await createUser();
    const wrong = await getTransferByToken({ token, actorUserId: someoneElse._id });
    expect(wrong.canAccept).toBe(false);
    await expect(acceptTicketTransfer({ transferId: wrong._id, actorUserId: someoneElse._id })).rejects.toMatchObject({
      statusCode: 404,
    });

    const newbie = await createUser({ email: "newbie@example.com" });
    const right = await getTransferByToken({ token, actorUserId: newbie._id });
    expect(right.canAccept).toBe(true);
    await acceptTicketTransfer({ transferId: right._id, actorUserId: newbie._id });
    expect(String((await EventTicket.findById(ticket._id)).buyerUserId)).toBe(String(newbie._id));
  });

  test("the claim link's secret is not stored as is", async () => {
    const { sender, ticket } = await heldTicket();
    await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "pal@example.com" } });
    const token = decodeURIComponent(dispatchEmail.mock.calls[0][0].text.match(/claim\/([A-Za-z0-9_%-]+)/)[1]);
    const stored = await TicketTransfer.findOne({ ticketId: ticket._id });

    expect(stored.tokenHash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored.toJSON())).not.toContain(token);
  });

  test("a listed or used ticket can't be sent, and a sending ticket can't be listed", async () => {
    /* Sold out, so resale itself is open and only the send stands in the way. */
    const { sender, ticket } = await heldTicket({ expectedTickets: 1 });
    await createUser({ handle: "pal" });

    await EventTicket.updateOne({ _id: ticket._id }, { $set: { resaleStatus: "listed" } });
    await expect(
      createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "@pal" } }),
    ).rejects.toMatchObject({ code: "TRANSFER_WHILE_LISTED" });

    await EventTicket.updateOne({ _id: ticket._id }, { $set: { resaleStatus: "none" } });
    await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "@pal" } });
    await expect(
      createTicketResale({ ticketId: ticket._id, actorUserId: sender._id, payload: { priceNaira: 9000 } }),
    ).rejects.toMatchObject({ code: "RESALE_WHILE_SENDING" });
  });

  test("a ticket used at the door before acceptance doesn't move", async () => {
    const { sender, ticket } = await heldTicket();
    const friend = await createUser({ handle: "late" });
    const transfer = await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "@late" } });
    await EventTicket.updateOne({ _id: ticket._id }, { $set: { status: "used", usedAt: new Date() } });

    await expect(acceptTicketTransfer({ transferId: transfer._id, actorUserId: friend._id })).rejects.toMatchObject({
      code: "TRANSFER_CLOSED",
    });
    expect(String((await EventTicket.findById(ticket._id)).buyerUserId)).toBe(String(sender._id));
  });

  test("accepting twice at once moves it once; declining and cancelling leave it with the sender", async () => {
    const { sender, ticket } = await heldTicket();
    const friend = await createUser({ handle: "twice" });
    const transfer = await createTicketTransfer({ ticketId: ticket._id, actorUserId: sender._id, payload: { to: "@twice" } });

    const results = await Promise.allSettled([
      acceptTicketTransfer({ transferId: transfer._id, actorUserId: friend._id }),
      acceptTicketTransfer({ transferId: transfer._id, actorUserId: friend._id }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const second = await heldTicket();
    const other = await createUser({ handle: "nope" });
    const declined = await createTicketTransfer({ ticketId: second.ticket._id, actorUserId: second.sender._id, payload: { to: "@nope" } });
    await declineTicketTransfer({ transferId: declined._id, actorUserId: other._id });
    await createTicketTransfer({ ticketId: second.ticket._id, actorUserId: second.sender._id, payload: { to: "@nope" } });
    await cancelTicketTransfer({ ticketId: second.ticket._id, actorUserId: second.sender._id });
    expect(String((await EventTicket.findById(second.ticket._id)).buyerUserId)).toBe(String(second.sender._id));
  });
});

describe("waitlist", () => {
  const soldOutEvent = async () => {
    const organizer = await createUser();
    const event = await upcoming(organizer._id, { expectedTickets: 1 });
    const holder = await createUser();
    const ticket = await createPaidTicket({ event, buyerUserId: holder._id });
    return { event, ticket };
  };

  test("you can only join when it's sold out, and your place is counted", async () => {
    const { event } = await soldOutEvent();
    const first = await createUser();
    const second = await createUser();

    await joinWaitlist({ eventId: event._id, actorUserId: first._id });
    const status = await joinWaitlist({ eventId: event._id, actorUserId: second._id });

    expect(status).toMatchObject({ joined: true, status: "waiting", position: 2, waitingCount: 2 });

    const organizer = await createUser();
    const open = await upcoming(organizer._id, { expectedTickets: 50 });
    await expect(joinWaitlist({ eventId: open._id, actorUserId: first._id })).rejects.toMatchObject({ code: "NOT_SOLD_OUT" });
  });

  test("when a spot opens, the first in line is told, and only them", async () => {
    const { event, ticket } = await soldOutEvent();
    const first = await createUser();
    const second = await createUser();
    await joinWaitlist({ eventId: event._id, actorUserId: first._id });
    await joinWaitlist({ eventId: event._id, actorUserId: second._id });

    await EventTicket.updateOne({ _id: ticket._id }, { $set: { status: "refunded" } });
    await processWaitlists({});
    await processWaitlists({});

    expect((await getMyWaitlistStatus({ eventId: event._id, actorUserId: first._id })).status).toBe("notified");
    expect((await getMyWaitlistStatus({ eventId: event._id, actorUserId: second._id })).status).toBe("waiting");
    expect(await Notification.countDocuments({ userId: first._id, type: "event.waitlist.spot_open" })).toBe(1);
  });

  test("if they don't buy in time, the next person gets a turn", async () => {
    const { event, ticket } = await soldOutEvent();
    const first = await createUser();
    const second = await createUser();
    await joinWaitlist({ eventId: event._id, actorUserId: first._id });
    await joinWaitlist({ eventId: event._id, actorUserId: second._id });
    await EventTicket.updateOne({ _id: ticket._id }, { $set: { status: "refunded" } });
    await processWaitlists({});

    await processWaitlists({ now: new Date(Date.now() + NOTIFIED_HOLD_MS + 60 * 1000) });

    expect((await EventWaitlistEntry.findOne({ userId: first._id })).status).toBe("expired");
    expect((await EventWaitlistEntry.findOne({ userId: second._id })).status).toBe("notified");
  });

  test("leaving takes you off the list", async () => {
    const { event } = await soldOutEvent();
    const person = await createUser();
    await joinWaitlist({ eventId: event._id, actorUserId: person._id });

    const status = await leaveWaitlist({ eventId: event._id, actorUserId: person._id });

    expect(status).toMatchObject({ joined: false, waitingCount: 0 });
  });
});

describe("routes", () => {
  test("the fixed transfer paths are reached, not read as an event id", async () => {
    const request = require("supertest");
    const app = require("../app");
    const { signAccessToken } = require("../utils/jwt");
    const user = await createUser();

    const response = await request(app)
      .get("/api/events/transfers/incoming")
      .set("Authorization", `Bearer ${signAccessToken({ userId: String(user._id) })}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
  });
});
