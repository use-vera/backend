const request = require("supertest");

jest.mock("../services/llm.service", () => ({ chat: jest.fn() }));

const app = require("../app");
const env = require("../config/env");
const llm = require("../services/llm.service");
const { signAccessToken } = require("../utils/jwt");
const Follow = require("../models/follow.model");
const User = require("../models/user.model");
const VeraMessage = require("../models/vera-message.model");
const VeraSettings = require("../models/vera-settings.model");
const { summarise } = require("../services/weather.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR = 60 * 60 * 1000;
const future = (hours) => new Date(Date.now() + hours * HOUR);

/* A fake model that plays back a script, one step per call. */
const script = (...steps) => {
  llm.chat.mockReset();
  for (const step of steps) {
    llm.chat.mockImplementationOnce(async (input) => (typeof step === "function" ? step(input) : step));
  }
};
const say = (content) => ({ content, toolCalls: [] });
const call = (name, args = {}) => ({ content: "", toolCalls: [{ id: `c_${name}`, name, arguments: args }] });

const send = (user, body) => request(app).post("/api/vera/messages").set("Authorization", auth(user)).send(body);

describe("vera settings", () => {
  test("defaults, partial updates, and unknown switches refused", async () => {
    const me = await createUser();

    const initial = await request(app).get("/api/vera/settings").set("Authorization", auth(me));
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({
      enabled: true,
      sees: { location: true, weather: true, ratings: true, following: true, calendar: false, budget: false, usualSpend: true },
      weeklyBudgetNaira: null,
      usage: { used: 0, cap: env.veraDailyFreeMessages, unlimited: false },
    });

    const updated = await request(app)
      .patch("/api/vera/settings")
      .set("Authorization", auth(me))
      .send({ sees: { following: false, budget: true }, weeklyBudgetNaira: 20000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.sees.following).toBe(false);
    expect(updated.body.data.sees.location).toBe(true);
    expect(updated.body.data.weeklyBudgetNaira).toBe(20000);

    const unknown = await request(app).patch("/api/vera/settings").set("Authorization", auth(me)).send({ sees: { email: true } });
    expect(unknown.status).toBe(400);
  });
});

describe("talking to vera", () => {
  let originalCap;
  beforeEach(() => {
    originalCap = env.veraDailyFreeMessages;
  });
  afterEach(() => {
    env.veraDailyFreeMessages = originalCap;
  });

  test("searches, shows only real picks, saves both sides, and never leaks host emails to the model", async () => {
    const host = await createUser({ email: "host-private@example.com" });
    const me = await createUser();
    const jazz = await createEvent({ organizerUserId: host._id, name: "Jollof & Jazz", startsAt: future(3), endsAt: future(6), ticketPriceNaira: 6500 });

    let toolOutput = "";
    script(
      call("search_events", { when: "week", query: "jazz" }),
      (input) => {
        toolOutput = input.messages[input.messages.length - 1].content;
        return call("show_picks", {
          picks: [
            { eventId: String(jazz._id), why: "Live jazz, done by 10" },
            { eventId: "64b000000000000000000000", why: "made up" },
          ],
        });
      },
      say("Jollof & Jazz is a lovely easy night."),
    );

    const res = await send(me, { text: "what should I do tonight?" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBe("Jollof & Jazz is a lovely easy night.");
    expect(res.body.data.message.picks).toHaveLength(1);
    expect(res.body.data.message.picks[0]).toMatchObject({ eventId: String(jazz._id), name: "Jollof & Jazz", why: "Live jazz, done by 10" });
    expect(res.body.data.usage).toMatchObject({ used: 1, remaining: env.veraDailyFreeMessages - 1 });

    expect(JSON.parse(toolOutput).events.map((event) => event.name)).toEqual(["Jollof & Jazz"]);
    expect(toolOutput).not.toContain("host-private@example.com");

    const history = await request(app).get("/api/vera/messages").set("Authorization", auth(me));
    expect(history.body.data.items.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("if the model searches but forgets to pick, the top results are shown", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Rooftop", startsAt: future(2), endsAt: future(5) });
    script(call("search_events", { when: "week" }), say(""));

    const res = await send(me, { text: "anything tonight?" });
    expect(res.body.data.message.picks.map((pick) => pick.name)).toEqual(["Rooftop"]);
    expect(res.body.data.message.content).toBe("Here's what I found.");
  });

  test("every event named in the reply gets a card, in the order it's named", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Alpha Night", startsAt: future(2), endsAt: future(5) });
    const beta = await createEvent({ organizerUserId: host._id, name: "Beta Rooftop", startsAt: future(3), endsAt: future(6) });
    script(
      call("search_events", { when: "week" }),
      call("show_picks", { picks: [{ eventId: String(beta._id), why: "Great view" }] }),
      say('Try "Beta Rooftop", or "Alpha Night" if you want to dance.'),
    );

    const res = await send(me, { text: "tonight?" });
    expect(res.body.data.message.picks.map((pick) => pick.name)).toEqual(["Beta Rooftop", "Alpha Night"]);
    expect(res.body.data.message.picks[0].why).toBe("Great view");
  });

  test("shortened names still get their cards", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Community Prayer Night 22", startsAt: future(2), endsAt: future(5) });
    script(call("search_events", { when: "week" }), say('"Community Prayer Night" is on tonight.'));

    const res = await send(me, { text: "tonight?" });
    expect(res.body.data.message.picks.map((pick) => pick.name)).toEqual(["Community Prayer Night 22"]);
  });

  test("made-up events send her back to search; if she still invents, the reply is replaced", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Real Party", startsAt: future(2), endsAt: future(5) });

    let correction = "";
    script(
      say('How about "Evening Vibes"?'),
      (input) => {
        correction = input.messages[input.messages.length - 1].content;
        return call("search_events", { when: "week" });
      },
      say('"Real Party" is on tonight.'),
    );
    const fixed = await send(me, { text: "Hello" });
    expect(correction).toMatch(/evening vibes/);
    expect(fixed.body.data.message.content).toBe('"Real Party" is on tonight.');
    expect(fixed.body.data.message.picks.map((pick) => pick.name)).toEqual(["Real Party"]);

    script(say('Go to "Midnight Magic".'), say('Or "Summer Vibes".'));
    const stubborn = await send(me, { text: "next month?" });
    expect(stubborn.body.data.message.content).not.toMatch(/Midnight Magic|Summer Vibes/);
  });

  test("a follow-up about events she already showed still gets their cards, and old notes never leak", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Purple Friday", startsAt: future(30), endsAt: future(34) });
    script(call("search_events", { when: "week" }), say('"Purple Friday" looks good.'));
    await send(me, { text: "this week?" });

    let history = [];
    script((input) => {
      history = input.messages;
      return say('"Purple Friday" starts Friday at 8 pm. (Showed: Purple Friday)');
    });
    const res = await send(me, { text: "what time is that?" });
    expect(res.body.data.message.content).toBe('"Purple Friday" starts Friday at 8 pm.');
    expect(res.body.data.message.picks.map((pick) => pick.name)).toEqual(["Purple Friday"]);
    expect(history.some((message) => String(message.content).includes("Showed:"))).toBe(false);
  });

  test("next_month finds events past the usual 30 days", async () => {
    const host = await createUser();
    const me = await createUser();
    const local = new Date(Date.now() + HOUR);
    const nextMonthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - HOUR;
    const startsAt = new Date(nextMonthStart + 20 * 24 * HOUR);
    await createEvent({ organizerUserId: host._id, name: "Far Away Fest", startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR) });

    let toolOutput = "";
    script(call("search_events", { when: "next_month" }), (input) => {
      toolOutput = input.messages[input.messages.length - 1].content;
      return say("ok");
    });
    await send(me, { text: "next month?" });
    expect(JSON.parse(toolOutput).events.map((event) => event.name)).toEqual(["Far Away Fest"]);
  });

  test("switching off 'who you follow' hides friends from what the model sees", async () => {
    const host = await createUser();
    const me = await createUser();
    const ada = await createUser({ fullName: "Ada Obi" });
    const event = await createEvent({ organizerUserId: host._id, startsAt: future(2), endsAt: future(5) });
    await Follow.create({ followerUserId: me._id, followingUserId: ada._id });
    await createPaidTicket({ event, buyerUserId: ada._id });

    const seen = [];
    const capture = (input) => {
      seen.push(input.messages[input.messages.length - 1].content);
      return say("ok");
    };

    script(call("search_events", { when: "week" }), capture);
    await send(me, { text: "tonight?" });
    expect(JSON.parse(seen[0]).events[0].friendsGoing).toEqual(["Ada"]);

    await VeraSettings.updateOne({ userId: me._id }, { $set: { "sees.following": false } });
    script(call("search_events", { when: "week" }), capture);
    await send(me, { text: "tonight?" });
    expect(JSON.parse(seen[1]).events[0].friendsGoing).toEqual([]);
  });

  test("with nothing near the phone, Vera falls back to events across the city", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Lagos Night", startsAt: future(2), endsAt: future(5) });

    let toolOutput = "";
    script(call("search_events", { when: "week" }), (input) => {
      toolOutput = input.messages[input.messages.length - 1].content;
      return say("ok");
    });
    /* San Francisco: nowhere near the test event in Lagos. */
    await send(me, { text: "tonight?", location: { lat: 37.77, lng: -122.42 } });
    const parsed = JSON.parse(toolOutput);
    expect(parsed.events.map((event) => event.name)).toEqual(["Lagos Night"]);
    expect(parsed.note).toMatch(/across their city/);
  });

  test("budget left this week shows as an input", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await createEvent({ organizerUserId: host._id, startsAt: future(2), endsAt: future(5) });
    const ticket = await createPaidTicket({ event, buyerUserId: me._id });
    await VeraSettings.create({ userId: me._id, sees: { budget: true }, weeklyBudgetNaira: 50000 });

    script(say("Sure."));
    const res = await send(me, { text: "hi" });
    expect(res.body.data.message.inputs).toContain(`₦${(50000 - ticket.totalPriceNaira).toLocaleString("en-NG")} left this week`);
  });

  test("the free daily cap holds; premium has none", async () => {
    env.veraDailyFreeMessages = 2;
    const me = await createUser();
    for (let i = 0; i < 2; i += 1) {
      script(say("hi"));
      expect((await send(me, { text: "hey" })).status).toBe(201);
    }
    script(say("hi"));
    const blocked = await send(me, { text: "hey" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code || blocked.body.code).toBe("VERA_DAILY_LIMIT");

    const premium = await createUser({ subscriptionTier: "premium", premiumExpiresAt: future(24 * 30) });
    for (let i = 0; i < 3; i += 1) {
      script(say("hi"));
      expect((await send(premium, { text: "hey" })).status).toBe(201);
    }
    const settings = await request(app).get("/api/vera/settings").set("Authorization", auth(premium));
    expect(settings.body.data.usage).toMatchObject({ used: 3, unlimited: true });
  });

  test("a failed reply doesn't cost a message or save anything", async () => {
    const me = await createUser();
    llm.chat.mockReset();
    const ApiError = require("../utils/api-error");
    llm.chat.mockRejectedValueOnce(new ApiError(503, "down", null, "VERA_UNAVAILABLE"));

    const res = await send(me, { text: "hey" });
    expect(res.status).toBe(503);
    expect(await VeraMessage.countDocuments({ userId: me._id })).toBe(0);
    const settings = await request(app).get("/api/vera/settings").set("Authorization", auth(me));
    expect(settings.body.data.usage.used).toBe(0);
  });

  test("turned off, Vera refuses; clearing removes the conversation", async () => {
    const me = await createUser();
    script(say("hi"));
    await send(me, { text: "hey" });
    const cleared = await request(app).delete("/api/vera/messages").set("Authorization", auth(me));
    expect(cleared.status).toBe(200);
    expect(await VeraMessage.countDocuments({ userId: me._id })).toBe(0);

    await request(app).patch("/api/vera/settings").set("Authorization", auth(me)).send({ enabled: false });
    const off = await send(me, { text: "hey" });
    expect(off.status).toBe(403);
    expect(await User.exists({ _id: me._id })).toBeTruthy();
  });

  test("empty and oversized messages are refused", async () => {
    const me = await createUser();
    expect((await send(me, { text: "   " })).status).toBe(400);
    expect((await send(me, { text: "x".repeat(501) })).status).toBe(400);
  });
});

describe("rain outlook", () => {
  const times = ["2026-10-24T18:00", "2026-10-24T19:00", "2026-10-24T20:00", "2026-10-24T21:00"];
  test("dry, rain later, and rain now", () => {
    expect(summarise({ times, chances: [10, 5, 0, 20], nowKey: "2026-10-24T18" })).toBe("Dry till 9PM");
    expect(summarise({ times, chances: [10, 5, 70, 80], nowKey: "2026-10-24T18" })).toBe("Rain likely from 8PM");
    expect(summarise({ times, chances: [90, 5, 0, 0], nowKey: "2026-10-24T18" })).toBe("Raining or about to");
    expect(summarise({ times, chances: [], nowKey: "2026-10-24T18" })).toBeNull();
  });
});
