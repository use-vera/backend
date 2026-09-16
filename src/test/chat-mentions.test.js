const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const Notification = require("../models/notification.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;
const HOUR_MS = 60 * 60 * 1000;

const setup = async () => {
  const organizer = await createUser({ fullName: "Ada Organizer" });
  const alice = await createUser({ fullName: "Alice Attendee" });
  const bob = await createUser({ fullName: "Bob Attendee" });

  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 24 * HOUR_MS),
    endsAt: new Date(Date.now() + 30 * HOUR_MS),
  });

  await createPaidTicket({ event, buyerUserId: alice._id });
  await createPaidTicket({ event, buyerUserId: bob._id });

  return { organizer, alice, bob, event };
};

const send = (event, sender, body) =>
  request(app)
    .post(`/api/events/${event._id}/chat`)
    .set("Authorization", auth(sender))
    .send(body);

const mentionsFor = (userId) =>
  Notification.find({ userId, type: "event.chat.mention" }).lean();

/* Sending does not wait for its notifications: a push that fails must not
   fail the message. That makes them a settled-shortly fact rather than a
   settled-already one, so the test waits for them instead of racing them. */
const settledMentionsFor = async (userId, expected) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await mentionsFor(userId);

    if (rows.length >= expected) {
      return rows;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return mentionsFor(userId);
};

test("@chat alerts the whole room, but only from the organizer", async () => {
  const { organizer, alice, bob, event } = await setup();

  // An attendee cannot wake 400 people up.
  const refused = await send(event, alice, { message: "@chat where is gate B" });
  expect(refused.status).toBe(403);
  expect(refused.body.code || refused.body.data?.code).toBe("MENTION_NOT_ALLOWED");

  // And the refusal must not leave the message posted with the ping stripped.
  const listed = await request(app)
    .get(`/api/events/${event._id}/chat`)
    .set("Authorization", auth(alice));
  expect(listed.body.data.items).toHaveLength(0);

  const allowed = await send(event, organizer, {
    message: "@chat doors open in ten minutes",
  });
  expect(allowed.status).toBe(201);

  expect(await settledMentionsFor(alice._id, 1)).toHaveLength(1);
  expect(await settledMentionsFor(bob._id, 1)).toHaveLength(1);
  // The sender is never notified about their own message.
  expect(await mentionsFor(organizer._id)).toHaveLength(0);
});

test("an individual mention reaches one person, from anyone", async () => {
  const { organizer, alice, bob, event } = await setup();

  const sent = await send(event, alice, {
    message: "Bob Attendee are you here yet?",
    mentionedUserIds: [String(bob._id)],
  });
  expect(sent.status).toBe(201);

  expect(await settledMentionsFor(bob._id, 1)).toHaveLength(1);
  expect(await mentionsFor(organizer._id)).toHaveLength(0);
});

test("a mention cannot be used to notify someone outside the event", async () => {
  const { alice, bob, event } = await setup();
  const outsider = await createUser({ fullName: "Eve Outsider" });

  const sent = await send(event, alice, {
    message: "hello there",
    mentionedUserIds: [String(outsider._id), String(bob._id)],
  });
  expect(sent.status).toBe(201);

  // Bob is in the room, Eve is not and must not be reachable this way.
  expect(await settledMentionsFor(bob._id, 1)).toHaveLength(1);
  expect(await mentionsFor(outsider._id)).toHaveLength(0);
});

test("an ordinary message notifies nobody by mention", async () => {
  const { organizer, alice, bob, event } = await setup();

  const sent = await send(event, alice, { message: "see you all at 8" });
  expect(sent.status).toBe(201);

  expect(await mentionsFor(bob._id)).toHaveLength(0);
  expect(await mentionsFor(organizer._id)).toHaveLength(0);
});

test("the composer is told who it may offer and whether @chat is allowed", async () => {
  const { organizer, alice, event } = await setup();

  const forOrganizer = await request(app)
    .get(`/api/events/${event._id}/chat/mentions`)
    .set("Authorization", auth(organizer));
  expect(forOrganizer.status).toBe(200);
  expect(forOrganizer.body.data.canMentionEveryone).toBe(true);
  expect(
    forOrganizer.body.data.items.map((row) => row.fullName).sort(),
  ).toEqual(["Alice Attendee", "Bob Attendee"]);

  const forAttendee = await request(app)
    .get(`/api/events/${event._id}/chat/mentions`)
    .set("Authorization", auth(alice));
  expect(forAttendee.status).toBe(200);
  expect(forAttendee.body.data.canMentionEveryone).toBe(false);
  // Never offered yourself, and the organizer is a valid target.
  expect(forAttendee.body.data.items.map((row) => row.fullName).sort()).toEqual([
    "Ada Organizer",
    "Bob Attendee",
  ]);

  const searched = await request(app)
    .get(`/api/events/${event._id}/chat/mentions?search=bob`)
    .set("Authorization", auth(alice));
  expect(searched.body.data.items).toHaveLength(1);
  expect(searched.body.data.items[0].fullName).toBe("Bob Attendee");
});

const {
  buildEventChatSendPayload,
} = require("../realtime/chat-payload");

/* The app sends chat over the socket, not over HTTP. Both transports build
   their own payload object, so a field the service reads has to be forwarded
   by each one; the tests above would all still pass while every mention sent
   from the real app was quietly dropped in transit. */
test("the socket transport forwards everything the service reads", async () => {
  const built = buildEventChatSendPayload({
    eventId: "ignored-here",
    message: "  hey @chat  ",
    messageType: "text",
    metadata: { a: 1 },
    replyToMessageId: "r1",
    forwardedFromMessageId: "f1",
    mentionedUserIds: ["u1", "u2"],
  });

  expect(built.mentionedUserIds).toEqual(["u1", "u2"]);
  expect(built.message).toBe("hey @chat");
  expect(built.messageType).toBe("text");
  expect(built.metadata).toEqual({ a: 1 });
  expect(built.replyToMessageId).toBe("r1");
  expect(built.forwardedFromMessageId).toBe("f1");

  // A sender that mentions nobody must not send an empty array as a mention.
  expect(buildEventChatSendPayload({ message: "hi" }).mentionedUserIds).toBeUndefined();
  // And a hostile client cannot smuggle a non-array through.
  expect(
    buildEventChatSendPayload({ message: "hi", mentionedUserIds: "u1" })
      .mentionedUserIds,
  ).toBeUndefined();
});

/* The rendered message highlights exactly the runs the server recorded. If a
   sender could name those runs, any message could paint its own text as a
   mention of somebody. */
test("a message carries the server's mentions, not the sender's claim", async () => {
  const { organizer, alice, bob, event } = await setup();

  const sent = await send(event, alice, {
    message: "Bob Attendee and @chatter, look",
    mentionedUserIds: [String(bob._id)],
  });
  expect(sent.status).toBe(201);
  expect(sent.body.data.mentions.everyone).toBe(false);
  expect(sent.body.data.mentions.users).toEqual([
    { userId: String(bob._id), name: "Bob Attendee" },
  ]);

  const broadcast = await send(event, organizer, { message: "@chat go" });
  expect(broadcast.body.data.mentions.everyone).toBe(true);
  expect(broadcast.body.data.mentions.users).toEqual([]);

  // Read back the same way the chat list loads it, not just the send reply.
  const listed = await request(app)
    .get(`/api/events/${event._id}/chat`)
    .set("Authorization", auth(bob));
  const mine = listed.body.data.items.find(
    (row) => row.message === "Bob Attendee and @chatter, look",
  );
  expect(mine.mentions.users[0].name).toBe("Bob Attendee");
});
