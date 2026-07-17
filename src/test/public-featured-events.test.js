const mongoose = require("mongoose");
const { listPublicFeaturedEvents } = require("../services/event.service");
const { todayDateKey } = require("../services/featured-event.service");
const FeaturedEventSlot = require("../models/featured-event-slot.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const createActiveSlot = ({ event, organizerUserId }) =>
  FeaturedEventSlot.create({
    eventId: event._id,
    organizerUserId,
    date: todayDateKey(),
    paymentAttemptId: new mongoose.Types.ObjectId(),
    status: "active",
  });

test("returns [] when no featured slots are active today", async () => {
  const result = await listPublicFeaturedEvents({ limit: 8 });
  expect(result).toEqual([]);
});

test("returns published events with active slots today, with no actor-scoped fields", async () => {
  const organizer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + HOUR_MS),
    endsAt: new Date(Date.now() + 3 * HOUR_MS),
  });
  await createActiveSlot({ event, organizerUserId: organizer._id });

  const result = await listPublicFeaturedEvents({ limit: 8 });

  expect(result).toHaveLength(1);
  expect(String(result[0]._id)).toBe(String(event._id));
  expect(result[0].myTicket).toBeNull();
  expect(result[0].friendsGoingCount).toBe(0);
});

test("excludes events whose slot is not active (pending/cancelled/expired)", async () => {
  const organizer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + HOUR_MS),
    endsAt: new Date(Date.now() + 3 * HOUR_MS),
  });
  await FeaturedEventSlot.create({
    eventId: event._id,
    organizerUserId: organizer._id,
    date: todayDateKey(),
    paymentAttemptId: new mongoose.Types.ObjectId(),
    status: "pending_payment",
  });

  const result = await listPublicFeaturedEvents({ limit: 8 });
  expect(result).toEqual([]);
});

test("excludes an event that has already ended, even with an active slot", async () => {
  const organizer = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() - 3 * HOUR_MS),
    endsAt: new Date(Date.now() - HOUR_MS),
  });
  await createActiveSlot({ event, organizerUserId: organizer._id });

  const result = await listPublicFeaturedEvents({ limit: 8 });
  expect(result).toEqual([]);
});

test("respects the limit and clamps to a sane range", async () => {
  const organizer = await createUser();

  for (let index = 0; index < 3; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const event = await createEvent({
      organizerUserId: organizer._id,
      startsAt: new Date(Date.now() + HOUR_MS),
      endsAt: new Date(Date.now() + 3 * HOUR_MS),
    });
    // eslint-disable-next-line no-await-in-loop
    await createActiveSlot({ event, organizerUserId: organizer._id });
  }

  const result = await listPublicFeaturedEvents({ limit: 2 });
  expect(result).toHaveLength(2);
});
