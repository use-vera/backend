const mongoose = require("mongoose");
const {
  createTicketResale,
} = require("../services/event.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/* Every case needs an event that is still selling, so the unlock rule is what
   decides the outcome rather than the older "event has started" guard. */
const futureEvent = (organizerUserId, overrides = {}) =>
  createEvent({
    organizerUserId,
    startsAt: new Date(Date.now() + 72 * HOUR_MS),
    endsAt: new Date(Date.now() + 78 * HOUR_MS),
    resale: { enabled: true, allowBids: true, maxMarkupPercent: 20, bidWindowHours: 24 },
    ...overrides,
  });

const tier = (name, quantity, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name,
  priceNaira: 10000,
  quantity,
  ...extra,
});

test("a ticket cannot be resold while its tier is still on sale", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const vip = tier("VIP", 50);

  const event = await futureEvent(organizer._id, { ticketCategories: [vip] });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    ticketCategoryId: vip._id,
    ticketCategoryName: vip.name,
  });

  // This is the whole point: bought a minute ago, organizer still has 49 left.
  await expect(
    createTicketResale({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      payload: { priceNaira: 11000 },
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "RESALE_NOT_UNLOCKED" });
});

test("resale opens once the tier sells out", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  // One ticket released, and the buyer holds it.
  const vip = tier("VIP", 1);

  const event = await futureEvent(organizer._id, { ticketCategories: [vip] });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    ticketCategoryId: vip._id,
    ticketCategoryName: vip.name,
  });

  const listed = await createTicketResale({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    payload: { priceNaira: 11000 },
  });

  expect(listed.resaleStatus).toBe("listed");
});

test("resale opens once the tier's sale window closes", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const early = tier("Early bird", 100, {
    availableUntil: new Date(Date.now() - HOUR_MS),
  });

  const event = await futureEvent(organizer._id, { ticketCategories: [early] });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    ticketCategoryId: early._id,
    ticketCategoryName: early.name,
  });

  // 99 unsold, but the organizer stopped selling them.
  const listed = await createTicketResale({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    payload: { priceNaira: 11000 },
  });

  expect(listed.resaleStatus).toBe("listed");
});

test("an event with no tiers unlocks only when it reaches capacity", async () => {
  const organizer = await createUser();
  const buyer = await createUser();

  const roomy = await futureEvent(organizer._id, { expectedTickets: 100 });
  const roomyTicket = await createPaidTicket({ event: roomy, buyerUserId: buyer._id });

  await expect(
    createTicketResale({
      ticketId: roomyTicket._id,
      actorUserId: buyer._id,
      payload: { priceNaira: 11000 },
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "RESALE_NOT_UNLOCKED" });

  const soldOut = await futureEvent(organizer._id, { expectedTickets: 1 });
  const lastTicket = await createPaidTicket({ event: soldOut, buyerUserId: buyer._id });

  const listed = await createTicketResale({
    ticketId: lastTicket._id,
    actorUserId: buyer._id,
    payload: { priceNaira: 11000 },
  });

  expect(listed.resaleStatus).toBe("listed");
});
