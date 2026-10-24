/* The Tickets tab list: which tickets it shows and the labels it leads with. */

const { listMyTickets } = require("../services/event.service");
const EventRating = require("../models/event-rating.model");
const TicketResaleBid = require("../models/ticket-resale-bid.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const upcomingEvent = (organizer, overrides = {}) =>
  createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 52 * HOUR_MS),
    ticketCategories: [
      { name: "Regular", quantity: 100, priceNaira: 10000 },
      { name: "VIP", quantity: 20, priceNaira: 30000 },
    ],
    ...overrides,
  });

const byId = (result) => new Map(result.items.map((item) => [String(item._id), item]));

test('"wallet" includes a ticket still waiting on payment; "all" still does not', async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await upcomingEvent(organizer);
  const pending = await createPaidTicket({ event, buyerUserId: buyer._id, status: "pending" });

  const wallet = await listMyTickets({ actorUserId: buyer._id, status: "wallet" });
  const all = await listMyTickets({ actorUserId: buyer._id, status: "all" });

  expect(byId(wallet).get(String(pending._id))?.walletState).toBe("pending");
  expect(byId(all).has(String(pending._id))).toBe(false);
});

test("each ticket leads with the right label", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const bidder = await createUser();
  const future = await upcomingEvent(organizer);
  const finished = await createEvent({ organizerUserId: organizer._id });
  const finishedAndRated = await createEvent({ organizerUserId: organizer._id });

  const active = await createPaidTicket({ event: future, buyerUserId: buyer._id });
  const refunded = await createPaidTicket({ event: future, buyerUserId: buyer._id, status: "refunded" });
  const listed = await createPaidTicket({
    event: future,
    buyerUserId: buyer._id,
    resaleStatus: "listed",
    resalePriceNaira: 12000,
  });
  const toRate = await createPaidTicket({ event: finished, buyerUserId: buyer._id, status: "used" });
  const attended = await createPaidTicket({ event: finishedAndRated, buyerUserId: buyer._id, status: "used" });

  await EventRating.create({ eventId: finishedAndRated._id, userId: buyer._id, rating: 5 });
  await TicketResaleBid.create([
    { ticketId: listed._id, eventId: future._id, sellerUserId: buyer._id, bidderUserId: bidder._id, amountNaira: 11000, status: "open" },
    { ticketId: listed._id, eventId: future._id, sellerUserId: buyer._id, bidderUserId: bidder._id, amountNaira: 9000, status: "rejected" },
  ]);

  const items = byId(await listMyTickets({ actorUserId: buyer._id, status: "wallet" }));

  expect(items.get(String(active._id)).walletState).toBe("active");
  expect(items.get(String(refunded._id)).walletState).toBe("refunded");
  expect(items.get(String(listed._id)).walletState).toBe("listed");
  expect(items.get(String(listed._id)).openBidsCount).toBe(1);
  expect(items.get(String(toRate._id)).walletState).toBe("to_rate");
  expect(items.get(String(attended._id)).walletState).toBe("attended");
});

test("canUpgrade only when a pricier tier is on sale and the event is still ahead", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const future = await upcomingEvent(organizer);
  const started = await upcomingEvent(organizer, {
    startsAt: new Date(Date.now() - HOUR_MS),
    endsAt: new Date(Date.now() + 3 * HOUR_MS),
  });
  const onlyTier = await upcomingEvent(organizer, {
    ticketCategories: [{ name: "Regular", quantity: 100, priceNaira: 10000 }],
  });

  const upgradable = await createPaidTicket({ event: future, buyerUserId: buyer._id });
  const tooLate = await createPaidTicket({ event: started, buyerUserId: buyer._id });
  const nowhereToGo = await createPaidTicket({ event: onlyTier, buyerUserId: buyer._id });
  const listed = await createPaidTicket({ event: future, buyerUserId: buyer._id, resaleStatus: "listed", resalePriceNaira: 11000 });

  const items = byId(await listMyTickets({ actorUserId: buyer._id, status: "wallet" }));

  expect(items.get(String(upgradable._id)).canUpgrade).toBe(true);
  expect(items.get(String(tooLate._id)).canUpgrade).toBe(false);
  expect(items.get(String(nowhereToGo._id)).canUpgrade).toBe(false);
  expect(items.get(String(listed._id)).canUpgrade).toBe(false);
});

test("tier prices used for canUpgrade don't travel with the list", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await upcomingEvent(organizer);
  await createPaidTicket({ event, buyerUserId: buyer._id });

  const [item] = (await listMyTickets({ actorUserId: buyer._id, status: "wallet" })).items;

  expect(item.eventId.ticketCategories).toBeUndefined();
});
