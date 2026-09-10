const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const {
  initializeTicketPurchase,
  listTicketUpgradeOptions,
  initializeTicketUpgrade,
} = require("../services/event.service");
const EventTicket = require("../models/event-ticket.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const tier = (name, priceNaira, quantity) => ({
  _id: new mongoose.Types.ObjectId(),
  name,
  priceNaira,
  quantity,
});

/* Paid, because a free event records a ₦0 unit price and there would be no
   difference to upgrade. No Paystack key is set in tests, so the dev-bypass
   branch issues and upgrades instantly. */
const sellingEvent = async (organizerUserId, tiers) =>
  createEvent({
    organizerUserId,
    isPaid: true,
    ticketPriceNaira: 20000,
    expectedTickets: 200,
    startsAt: new Date(Date.now() + 72 * HOUR_MS),
    endsAt: new Date(Date.now() + 78 * HOUR_MS),
    ticketCategories: tiers,
  });

const buy = ({ event, buyer, tier: chosen, quantity = 1 }) =>
  initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: {
      quantity,
      email: "buyer@example.com",
      ticketCategoryId: String(chosen._id),
    },
  });

test("upgrade options price the difference, not the full tier", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const vip = tier("VIP", 50000, 12);
  const event = await sellingEvent(organizer._id, [regular, vip]);

  const order = await buy({ event, buyer, tier: regular });
  const options = await listTicketUpgradeOptions({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
  });

  expect(options.paidNaira).toBe(20000);

  const vipOption = options.options.find((option) => option.name === "VIP");
  expect(vipOption.differenceNaira).toBe(30000);
  expect(vipOption.upgradable).toBe(true);

  // Your own tier is never an upgrade.
  const regularOption = options.options.find((option) => option.name === "Regular");
  expect(regularOption.isCurrent).toBe(true);
  expect(regularOption.upgradable).toBe(false);
});

test("a cheaper tier is not offered and is refused outright", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const cheap = tier("Balcony", 8000, 50);
  const event = await sellingEvent(organizer._id, [regular, cheap]);

  const order = await buy({ event, buyer, tier: regular });

  const options = await listTicketUpgradeOptions({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
  });
  expect(options.options.find((o) => o.name === "Balcony").upgradable).toBe(false);

  await expect(
    initializeTicketUpgrade({
      ticketId: order.ticket._id,
      actorUserId: buyer._id,
      payload: { ticketCategoryId: String(cheap._id) },
    }),
  ).rejects.toMatchObject({ statusCode: 400, code: "NOT_AN_UPGRADE" });
});

test("upgrading moves the tier, reissues the code and kills the old one", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const vip = tier("VIP", 50000, 12);
  const event = await sellingEvent(organizer._id, [regular, vip]);

  const order = await buy({ event, buyer, tier: regular });
  const originalCode = order.ticket.ticketCode;

  await initializeTicketUpgrade({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
    payload: { ticketCategoryId: String(vip._id) },
  });

  const after = await EventTicket.findById(order.ticket._id);

  expect(after.ticketCategoryName).toBe("VIP");
  expect(after.unitPriceNaira).toBe(50000);
  // The old QR must stop working: a screenshot of it cannot admit anyone.
  expect(after.ticketCode).not.toBe(originalCode);
  expect(after.barcodeValue).toContain(after.ticketCode);
  // And the intent is consumed, not left to run twice.
  expect(after.paymentMetadata.pendingUpgrade).toBeUndefined();
  expect(after.paymentMetadata.upgrades).toHaveLength(1);
});

test("the upgrade frees the old tier and takes from the new one", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const vip = tier("VIP", 50000, 1);
  const event = await sellingEvent(organizer._id, [regular, vip]);

  const order = await buy({ event, buyer, tier: regular });

  await initializeTicketUpgrade({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
    payload: { ticketCategoryId: String(vip._id) },
  });

  // The only VIP seat is now taken, so a second holder cannot have it.
  const other = await createUser();
  const second = await buy({ event, buyer: other, tier: regular });

  await expect(
    initializeTicketUpgrade({
      ticketId: second.ticket._id,
      actorUserId: other._id,
      payload: { ticketCategoryId: String(vip._id) },
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_INVENTORY" });
});

test("the organizer is credited the difference, not the whole tier", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const vip = tier("VIP", 50000, 12);
  const event = await sellingEvent(organizer._id, [regular, vip]);

  const order = await buy({ event, buyer, tier: regular });

  await initializeTicketUpgrade({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
    payload: { ticketCategoryId: String(vip._id) },
  });

  const [credit] = await WalletTransaction.find({
    organizerUserId: organizer._id,
    type: "ticket_upgrade",
  });

  expect(credit).toBeDefined();
  // ₦30,000 difference, less Vera's 5%.
  expect(credit.metadata.pricingBreakdown.totalBasePriceNaira).toBe(30000);
  expect(credit.amountKobo).toBe(28500 * 100);
});

test("a checked-in ticket cannot be upgraded", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const vip = tier("VIP", 50000, 12);
  const event = await sellingEvent(organizer._id, [regular, vip]);

  const order = await buy({ event, buyer, tier: regular });

  await EventTicket.updateOne(
    { _id: order.ticket._id },
    { $set: { status: "used", usedAt: new Date() } },
  );

  await expect(
    initializeTicketUpgrade({
      ticketId: order.ticket._id,
      actorUserId: buyer._id,
      payload: { ticketCategoryId: String(vip._id) },
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "TICKET_NOT_UPGRADABLE" });
});

describe("over HTTP", () => {
  const tokenFor = (user) => signAccessToken({ userId: String(user._id) });

  test("the upgrade routes work end to end", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const regular = tier("Regular", 20000, 50);
    const vip = tier("VIP", 50000, 12);
    const event = await sellingEvent(organizer._id, [regular, vip]);

    const order = await buy({ event, buyer, tier: regular });

    const options = await request(app)
      .get(`/api/events/tickets/${order.ticket._id}/upgrade-options`)
      .set("Authorization", `Bearer ${tokenFor(buyer)}`);

    if (options.status !== 200) {
      console.error("OPTIONS FAILED", options.status, options.body);
    }

    expect(options.status).toBe(200);
    expect(options.body.data.paidNaira).toBe(20000);

    const upgrade = await request(app)
      .post(`/api/events/tickets/${order.ticket._id}/upgrade/initialize`)
      .set("Authorization", `Bearer ${tokenFor(buyer)}`)
      .send({ ticketCategoryId: String(vip._id) });

    if (upgrade.status !== 200) {
      console.error("UPGRADE FAILED", upgrade.status, upgrade.body);
    }

    expect(upgrade.status).toBe(200);
    expect(upgrade.body.data.pricingBreakdown.totalBasePriceNaira).toBe(30000);
  });

  test("someone else cannot upgrade your ticket", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const stranger = await createUser();
    const regular = tier("Regular", 20000, 50);
    const vip = tier("VIP", 50000, 12);
    const event = await sellingEvent(organizer._id, [regular, vip]);

    const order = await buy({ event, buyer, tier: regular });

    const response = await request(app)
      .post(`/api/events/tickets/${order.ticket._id}/upgrade/initialize`)
      .set("Authorization", `Bearer ${tokenFor(stranger)}`)
      .send({ ticketCategoryId: String(vip._id) });

    expect(response.status).toBe(403);
  });
});

/* `nextOccurrenceAt` is derived by mapEventForResponse and never stored, so a
   populated event arrives without it and the ticket pass fell back to "date to
   be announced" on every ticket. */
test("a ticket carries its event's next occurrence, not a bare document", async () => {
  const { getTicketById } = require("../services/event.service");

  const organizer = await createUser();
  const buyer = await createUser();
  const regular = tier("Regular", 20000, 50);
  const event = await sellingEvent(organizer._id, [regular]);

  const order = await buy({ event, buyer, tier: regular });
  const detail = await getTicketById({
    ticketId: order.ticket._id,
    actorUserId: buyer._id,
  });

  expect(detail.eventId.nextOccurrenceAt).toBeInstanceOf(Date);
  expect(Number.isNaN(detail.eventId.nextOccurrenceAt.getTime())).toBe(false);
  expect(detail.eventId.nextOccurrenceEndsAt).toBeInstanceOf(Date);
});
