const request = require("supertest");

jest.mock("../services/llm.service", () => ({ chat: jest.fn() }));

const app = require("../app");
const llm = require("../services/llm.service");
const { signAccessToken } = require("../utils/jwt");
const EventTicket = require("../models/event-ticket.model");
const EventWaitlistEntry = require("../models/event-waitlist-entry.model");
const AppNotification = require("../models/notification.model");
const TicketHold = require("../models/ticket-hold.model");
const VeraWatch = require("../models/vera-watch.model");
const { initializeTicketPurchase, initializeResalePurchase } = require("../services/event.service");
const { runWatches } = require("../services/vera-watch.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR = 60 * 60 * 1000;
const future = (hours) => new Date(Date.now() + hours * HOUR);
const freeEvent = (organizerUserId, overrides = {}) =>
  createEvent({ organizerUserId, isPaid: false, ticketPriceNaira: 0, startsAt: future(24), endsAt: future(28), ...overrides });

const hold = (user, body) => request(app).post("/api/vera/holds").set("Authorization", auth(user)).send(body);
const watch = (user, body) => request(app).post("/api/vera/watches").set("Authorization", auth(user)).send(body);

describe("holds", () => {
  test("held tickets are taken for everyone but the holder, who can still buy them", async () => {
    const host = await createUser();
    const ada = await createUser();
    const ben = await createUser();
    const event = await freeEvent(host._id, { expectedTickets: 3 });

    const held = await hold(ada, { eventId: String(event._id), quantity: 2 });
    expect(held.status).toBe(201);
    expect(new Date(held.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);

    await expect(initializeTicketPurchase({ eventId: event._id, actorUserId: ben._id, payload: { quantity: 2 } })).rejects.toMatchObject({
      statusCode: 409,
    });
    await initializeTicketPurchase({ eventId: event._id, actorUserId: ben._id, payload: { quantity: 1 } });

    /* Ada's own hold doesn't block her, and buying uses it up. */
    await initializeTicketPurchase({ eventId: event._id, actorUserId: ada._id, payload: { quantity: 2 } });
    expect((await TicketHold.findById(held.body.data._id)).status).toBe("converted");
  });

  test("an expired hold stops counting", async () => {
    const host = await createUser();
    const ada = await createUser();
    const ben = await createUser();
    const event = await freeEvent(host._id, { expectedTickets: 2 });

    const held = await hold(ada, { eventId: String(event._id), quantity: 2 });
    await TicketHold.updateOne({ _id: held.body.data._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await initializeTicketPurchase({ eventId: event._id, actorUserId: ben._id, payload: { quantity: 2 } });
  });

  test("two events at a time; holding the same event again replaces the hold; sold out and closed are refused", async () => {
    const host = await createUser();
    const ada = await createUser();
    const [one, two, three] = await Promise.all([freeEvent(host._id), freeEvent(host._id), freeEvent(host._id)]);

    expect((await hold(ada, { eventId: String(one._id) })).status).toBe(201);
    expect((await hold(ada, { eventId: String(one._id), quantity: 2 })).status).toBe(201);
    expect(await TicketHold.countDocuments({ userId: ada._id, status: "active" })).toBe(1);
    expect((await hold(ada, { eventId: String(two._id) })).status).toBe(201);

    const third = await hold(ada, { eventId: String(three._id) });
    expect(third.status).toBe(409);
    expect(third.body.error?.code || third.body.code).toBe("HOLD_LIMIT");

    const tiny = await freeEvent(host._id, { expectedTickets: 1 });
    const ben = await createUser();
    await initializeTicketPurchase({ eventId: tiny._id, actorUserId: ben._id, payload: { quantity: 1 } });
    const cara = await createUser();
    const soldOut = await hold(cara, { eventId: String(tiny._id) });
    expect(soldOut.status).toBe(409);
    expect(soldOut.body.error?.code || soldOut.body.code).toBe("SOLD_OUT");

    const started = await freeEvent(host._id, { startsAt: new Date(Date.now() - HOUR), endsAt: future(2) });
    expect((await hold(cara, { eventId: String(started._id) })).status).toBe(409);
  });

  test("a held resale listing can't be bought by anyone else, and holds can be let go", async () => {
    const host = await createUser();
    const seller = await createUser();
    const ada = await createUser();
    const ben = await createUser();
    const event = await createEvent({ organizerUserId: host._id, startsAt: future(48), endsAt: future(52) });
    const ticket = await createPaidTicket({ event, buyerUserId: seller._id });
    await EventTicket.updateOne({ _id: ticket._id }, { $set: { resaleStatus: "listed", resalePriceNaira: 12000, resaleQuantity: 1 } });

    const held = await hold(ada, { resaleTicketId: String(ticket._id) });
    expect(held.status).toBe(201);
    expect(held.body.data.resalePriceNaira).toBe(12000);

    await expect(initializeResalePurchase({ ticketId: ticket._id, actorUserId: ben._id, payload: {} })).rejects.toMatchObject({
      statusCode: 409,
      code: "TICKET_HELD",
    });
    expect((await hold(ben, { resaleTicketId: String(ticket._id) })).status).toBe(409);

    const mine = await request(app).get("/api/vera/holds").set("Authorization", auth(ada));
    expect(mine.body.data.items).toHaveLength(1);
    const released = await request(app).delete(`/api/vera/holds/${held.body.data._id}`).set("Authorization", auth(ada));
    expect(released.status).toBe(200);
    expect((await hold(ben, { resaleTicketId: String(ticket._id) })).status).toBe(201);
  });
});

describe("watches", () => {
  test("a resale watch records prices, goes off under the line, tells the person and holds when asked", async () => {
    const host = await createUser();
    const seller = await createUser();
    const ada = await createUser();
    const event = await createEvent({ organizerUserId: host._id, name: "Detty Fest", startsAt: future(48), endsAt: future(52) });
    const ticket = await createPaidTicket({ event, buyerUserId: seller._id });
    await EventTicket.updateOne({ _id: ticket._id }, { $set: { resaleStatus: "listed", resalePriceNaira: 25000, resaleQuantity: 1 } });

    const created = await watch(ada, { kind: "resale_price", eventId: String(event._id), maxPriceNaira: 20000, action: "hold" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "watching", lowestPriceNaira: 25000, listingsSeen: 1 });
    expect(created.body.data.label).toBe("Tell me if a Detty Fest resale drops under ₦20,000");

    await EventTicket.updateOne({ _id: ticket._id }, { $set: { resalePriceNaira: 18000 } });
    await runWatches();

    const fired = await VeraWatch.findById(created.body.data._id);
    expect(fired.status).toBe("triggered");
    expect(fired.triggerPriceNaira).toBe(18000);
    expect(await TicketHold.exists({ userId: ada._id, kind: "resale", resaleTicketId: ticket._id, status: "active" })).toBeTruthy();
    expect(await AppNotification.exists({ userId: ada._id, type: "vera.watch.resale" })).toBeTruthy();

    /* A second tick doesn't alert twice. */
    await runWatches();
    expect(await AppNotification.countDocuments({ userId: ada._id, type: "vera.watch.resale" })).toBe(1);
  });

  test("a host watch goes off when they publish something new", async () => {
    const host = await createUser({ fullName: "Rooftop Sessions" });
    const ada = await createUser();
    const event = await freeEvent(host._id, { name: "Vol. 4" });

    const created = await watch(ada, { kind: "host_drop", eventId: String(event._id) });
    expect(created.body.data.label).toBe("Tell me when Rooftop Sessions announces their next event");
    await runWatches();
    expect((await VeraWatch.findById(created.body.data._id)).status).toBe("watching");

    const next = await freeEvent(host._id, { name: "Vol. 5" });
    await runWatches();
    const fired = await VeraWatch.findById(created.body.data._id);
    expect(fired.status).toBe("triggered");
    expect(String(fired.triggerEventId)).toBe(String(next._id));
    expect(await AppNotification.exists({ userId: ada._id, type: "vera.watch.host" })).toBeTruthy();
  });

  test("asking twice updates the watch; resale-off events are refused; stopping works; waitlists are listed", async () => {
    const host = await createUser();
    const ada = await createUser();
    const event = await createEvent({ organizerUserId: host._id, startsAt: future(48), endsAt: future(52) });

    await watch(ada, { kind: "resale_price", eventId: String(event._id), maxPriceNaira: 20000 });
    const again = await watch(ada, { kind: "resale_price", eventId: String(event._id), maxPriceNaira: 15000 });
    expect(again.body.data.maxPriceNaira).toBe(15000);
    expect(await VeraWatch.countDocuments({ userId: ada._id })).toBe(1);

    const noResale = await createEvent({ organizerUserId: host._id, startsAt: future(48), endsAt: future(52), resale: { enabled: false } });
    expect((await watch(ada, { kind: "resale_price", eventId: String(noResale._id), maxPriceNaira: 100 })).status).toBe(409);

    const ben = await createUser();
    await EventWaitlistEntry.create({ eventId: event._id, userId: ben._id, status: "waiting" });
    await EventWaitlistEntry.create({ eventId: event._id, userId: ada._id, status: "waiting" });
    const listed = await request(app).get("/api/vera/watches").set("Authorization", auth(ada));
    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.waitlists[0]).toMatchObject({ eventId: String(event._id), position: 2 });

    const stopped = await request(app).delete(`/api/vera/watches/${again.body.data._id}`).set("Authorization", auth(ada));
    expect(stopped.status).toBe(200);
    expect((await request(app).get("/api/vera/watches").set("Authorization", auth(ada))).body.data.items).toHaveLength(0);
  });
});

describe("vera suggests, the person confirms", () => {
  test("suggest_hold picks the cheapest tier on sale, and only known events can be offered", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await createEvent({
      organizerUserId: host._id,
      name: "Tiered Night",
      startsAt: future(30),
      endsAt: future(34),
      ticketCategories: [
        { name: "VIP", quantity: 10, priceNaira: 30000 },
        { name: "Regular", quantity: 50, priceNaira: 8000 },
      ],
    });

    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "suggest_hold", arguments: { eventId: String(event._id), quantity: 2 } }] })
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "b", name: "search_events", arguments: { when: "week" } }] })
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "c", name: "suggest_hold", arguments: { eventId: String(event._id), quantity: 2 } }] })
      .mockResolvedValueOnce({ content: '"Tiered Night" it is. Tap to hold.', toolCalls: [] });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "save me two for tiered night" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.actions).toEqual([
      expect.objectContaining({ type: "hold", eventId: String(event._id), quantity: 2, ticketCategoryName: "Regular", label: "Hold 2 Regular tickets for 10 min" }),
    ]);
    /* Offering isn't doing: nothing is held until the person taps. */
    expect(await TicketHold.countDocuments({ userId: me._id })).toBe(0);
  });

  test("claiming a hold without offering one is corrected; the button is added for the event they named", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await freeEvent(host._id, { name: "Community Prayer Night 22" });

    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "search_events", arguments: { when: "week" } }] })
      .mockResolvedValueOnce({ content: 'I\'ve held 2 tickets for "Community Prayer Night". (Held: Community Prayer Night)', toolCalls: [] })
      .mockResolvedValueOnce({ content: 'Done, I\'ve reserved them for "Community Prayer Night 22". You can confirm by checking your account.', toolCalls: [] });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "Hold 2 tickets for Community Prayer Night 22 for me" });
    const { content, actions } = res.body.data.message;
    expect(content).not.toMatch(/held|reserved|checking your account|\(Held/i);
    expect(actions).toEqual([expect.objectContaining({ type: "hold", eventId: String(event._id), quantity: 2 })]);
    expect(res.body.data.message.picks.map((pick) => pick.eventId)).toEqual([String(event._id)]);
    expect(await TicketHold.countDocuments({ userId: me._id })).toBe(0);
  });

});

describe("event details and live events", () => {
  const lastToolOutput = (input) => input.messages[input.messages.length - 1].content;

  test("get_event_details tells her everything, and naming the event shows its card", async () => {
    const host = await createUser({ fullName: "Ada Host" });
    const me = await createUser();
    const event = await createEvent({
      organizerUserId: host._id,
      name: "Jollof & Jazz",
      description: "Live band, all-white dress code.",
      startsAt: future(30),
      endsAt: future(34),
      ticketCategories: [
        { name: "Regular", quantity: 50, priceNaira: 6500 },
        { name: "VIP", quantity: 2, priceNaira: 20000 },
      ],
    });
    await createPaidTicket({ event, buyerUserId: me._id, ticketCategoryId: event.ticketCategories[1]._id });

    let details;
    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "get_event_details", arguments: { name: "jollof & jazz" } }] })
      .mockImplementationOnce(async (input) => {
        details = JSON.parse(lastToolOutput(input));
        return { content: '"Jollof & Jazz" starts in about 30 hours.', toolCalls: [] };
      });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "tell me about jollof and jazz" });
    expect(details).toMatchObject({
      name: "Jollof & Jazz",
      status: "upcoming",
      host: "Ada Host",
      description: "Live band, all-white dress code.",
      ticketsOnSale: true,
      yourTickets: 1,
      price: "from ₦6,500",
    });
    expect(details.starts).toMatch(/\d{1,2}:\d{2}/);
    expect(details.timing).toMatch(/^starts in/);
    expect(details.ticketTypes).toEqual([
      expect.objectContaining({ name: "Regular", left: 50, onSale: true }),
      expect.objectContaining({ name: "VIP", left: 1, onSale: true }),
    ]);
    expect(res.body.data.message.picks.map((pick) => pick.name)).toEqual(["Jollof & Jazz"]);
  });

  test("search leaves out events that have started unless asked; live ones are marked and can't be held", async () => {
    const host = await createUser();
    const me = await createUser();
    const live = await createEvent({ organizerUserId: host._id, name: "Already On", startsAt: new Date(Date.now() - HOUR), endsAt: future(3) });
    await createEvent({ organizerUserId: host._id, name: "Coming Up", startsAt: future(30), endsAt: future(34) });

    const outputs = [];
    const capture = (next) => async (input) => {
      outputs.push(lastToolOutput(input));
      return next;
    };
    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "search_events", arguments: { when: "week" } }] })
      .mockImplementationOnce(capture({ content: "", toolCalls: [{ id: "b", name: "search_events", arguments: { when: "now" } }] }))
      .mockImplementationOnce(capture({ content: "", toolCalls: [{ id: "c", name: "suggest_hold", arguments: { eventId: String(live._id) } }] }))
      .mockImplementationOnce(capture({ content: '"Already On" has started, so tickets are closed.', toolCalls: [] }));

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "what's on?" });
    expect(JSON.parse(outputs[0]).events.map((event) => event.name)).toEqual(["Coming Up"]);
    const now = JSON.parse(outputs[1]).events;
    expect(now.map((event) => event.name)).toEqual(["Already On"]);
    expect(now[0]).toMatchObject({ status: "live now", ticketsOnSale: false });
    expect(outputs[2]).toMatch(/can't be held/);
    expect(res.body.data.message.actions).toEqual([]);
    expect(res.body.data.message.picks[0]).toMatchObject({ name: "Already On", status: "live", why: expect.stringMatching(/^Live now/) });
  });

  test("a hold refused for a live event gets a fresh card, even when the event came from an earlier reply", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await createEvent({ organizerUserId: host._id, name: "Purple Friday", startsAt: new Date(Date.now() - HOUR), endsAt: future(5) });
    const VeraMessage = require("../models/vera-message.model");
    await VeraMessage.create({
      userId: me._id,
      role: "assistant",
      content: '"Purple Friday" looks fun.',
      picks: [{ eventId: event._id, name: "Purple Friday", why: "Coming up soon", status: "upcoming" }],
    });

    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "suggest_hold", arguments: { eventId: String(event._id) } }] })
      .mockResolvedValueOnce({ content: "Sorry about that.", toolCalls: [] });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "hold one for purple friday" });
    expect(res.body.data.message.picks[0]).toMatchObject({ name: "Purple Friday", status: "live", why: expect.stringMatching(/^Live now/) });
  });

  test("asking to hold a live event explains why it can't, instead of a generic reply", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Purple Friday", startsAt: new Date(Date.now() - HOUR), endsAt: future(5) });

    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "get_event_details", arguments: { name: "Purple Friday" } }] })
      .mockResolvedValueOnce({ content: "I've held 1 ticket for you.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Done, it's held.", toolCalls: [] });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "Hold 1 ticket for Purple Friday" });
    expect(res.body.data.message.actions).toEqual([]);
    expect(res.body.data.message.content).toMatch(/^I can't hold tickets for Purple Friday: ticket sales close once the event starts\./);
    expect(res.body.data.message.picks[0]).toMatchObject({ name: "Purple Friday", status: "live" });
  });

  test("markdown links, made-up web addresses and raw ids never reach the person", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await createEvent({ organizerUserId: host._id, name: "Data & AI Meetup 19", startsAt: future(30), endsAt: future(34) });

    llm.chat.mockReset();
    llm.chat
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "search_events", arguments: { when: "week" } }] })
      .mockResolvedValueOnce({
        content: `Try these:\n- [Data & AI Meetup 19](https://vera.events/event/${event._id}) - **free**, (${event._id})`,
        toolCalls: [],
      });

    const res = await request(app).post("/api/vera/messages").set("Authorization", auth(me)).send({ text: "this week?" });
    const { content, picks } = res.body.data.message;
    expect(content).not.toMatch(/https?:|\]\(|\*\*|[a-f0-9]{24}/);
    expect(content).toMatch(/Data & AI Meetup 19/);
    expect(picks.map((pick) => pick.name)).toEqual(["Data & AI Meetup 19"]);
  });
});
