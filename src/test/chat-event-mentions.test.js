/* "#Event" links in chat, and event cards sent to a DM. */

const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR = 60 * 60 * 1000;
const upcoming = (overrides = {}) => ({
  startsAt: new Date(Date.now() + 24 * HOUR),
  endsAt: new Date(Date.now() + 30 * HOUR),
  ...overrides,
});

const openDm = async (from, to) => {
  const res = await request(app).post("/api/chats/direct").set("Authorization", auth(from)).send({ recipientUserId: String(to._id) });
  expect(res.status).toBeLessThan(300);
  return res.body.data._id;
};

const sendDm = (from, conversationId, body) =>
  request(app).post(`/api/chats/direct/${conversationId}/messages`).set("Authorization", auth(from)).send(body);

describe("#event mentions", () => {
  test("suggestions are upcoming published events only, soonest first", async () => {
    const host = await createUser();
    const me = await createUser();
    await createEvent({ organizerUserId: host._id, name: "Afro Later", ...upcoming({ startsAt: new Date(Date.now() + 48 * HOUR), endsAt: new Date(Date.now() + 50 * HOUR) }) });
    await createEvent({ organizerUserId: host._id, name: "Afro Soon", ...upcoming() });
    await createEvent({ organizerUserId: host._id, name: "Afro Draft", status: "draft", ...upcoming() });
    await createEvent({ organizerUserId: host._id, name: "Afro Over" }); // fixture default: already ended

    const res = await request(app).get("/api/chats/event-mentions?search=afro").set("Authorization", auth(me));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((item) => item.name)).toEqual(["Afro Soon", "Afro Later"]);
  });

  test("a DM keeps only mentions that are real, published and still in the text, whatever metadata the client sends", async () => {
    const host = await createUser();
    const me = await createUser();
    const friend = await createUser();
    const jazz = await createEvent({ organizerUserId: host._id, name: "Jollof & Jazz", ...upcoming() });
    const draft = await createEvent({ organizerUserId: host._id, name: "Secret Party", status: "draft", ...upcoming() });
    const unnamed = await createEvent({ organizerUserId: host._id, name: "Not In Text", ...upcoming() });
    const conversationId = await openDm(me, friend);

    const res = await sendDm(me, conversationId, {
      message: "Coming to #Jollof & Jazz or #Secret Party?",
      eventMentionIds: [String(jazz._id), String(draft._id), String(unnamed._id)],
      metadata: { eventMentions: [{ eventId: String(unnamed._id), name: "anything I like" }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.message.metadata.eventMentions).toEqual([{ eventId: String(jazz._id), name: "Jollof & Jazz" }]);

    /* Editing the name out drops the link. */
    const messageId = res.body.data.message._id;
    const edited = await request(app)
      .patch(`/api/chats/direct/${conversationId}/messages/${messageId}`)
      .set("Authorization", auth(me))
      .send({ message: "Coming out tonight?" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.message.metadata.eventMentions).toEqual([]);
  });

  test("event chat keeps real mentions too", async () => {
    const host = await createUser();
    const me = await createUser();
    const event = await createEvent({ organizerUserId: host._id, name: "Main Night", ...upcoming() });
    const afterParty = await createEvent({ organizerUserId: host._id, name: "After Party", ...upcoming() });
    await createPaidTicket({ event, buyerUserId: me._id });

    const res = await request(app)
      .post(`/api/events/${event._id}/chat`)
      .set("Authorization", auth(me))
      .send({ message: "Who's going to #After Party after?", eventMentionIds: [String(afterParty._id)] });
    expect(res.status).toBe(201);
    expect(res.body.data.metadata.eventMentions).toEqual([{ eventId: String(afterParty._id), name: "After Party" }]);
  });
});

describe("event cards in a DM", () => {
  test("a published event sends as a card; a draft can't be shared", async () => {
    const host = await createUser();
    const me = await createUser();
    const friend = await createUser();
    const event = await createEvent({ organizerUserId: host._id, name: "Rooftop", ...upcoming() });
    const draft = await createEvent({ organizerUserId: host._id, name: "Unannounced", status: "draft", ...upcoming() });
    const conversationId = await openDm(me, friend);

    const shared = await sendDm(me, conversationId, { messageType: "event", message: "Shared an event", metadata: { eventId: String(event._id) } });
    expect(shared.status).toBe(201);
    expect(shared.body.data.message.metadata.event).toMatchObject({ eventId: String(event._id), name: "Rooftop" });

    const leaked = await sendDm(me, conversationId, { messageType: "event", message: "Shared an event", metadata: { eventId: String(draft._id) } });
    expect(leaked.status).toBe(404);
  });
});
