#!/usr/bin/env node

const bcrypt = require("bcryptjs");
const { connectDb } = require("../src/config/db");
const User = require("../src/models/user.model");
const Workspace = require("../src/models/workspace.model");
const Membership = require("../src/models/membership.model");
const Event = require("../src/models/event.model");
const EventTicket = require("../src/models/event-ticket.model");

const now = Date.now();

const locationPool = [
  {
    address: "Admiralty Way, Lekki Phase 1, Lagos",
    latitude: 6.4474,
    longitude: 3.4687,
  },
  {
    address: "Ozumba Mbadiwe Road, Victoria Island, Lagos",
    latitude: 6.4311,
    longitude: 3.4217,
  },
  {
    address: "University of Lagos, Akoka, Lagos",
    latitude: 6.5152,
    longitude: 3.3896,
  },
  {
    address: "Obafemi Awolowo Way, Ikeja, Lagos",
    latitude: 6.6018,
    longitude: 3.3515,
  },
  {
    address: "Port Harcourt Pleasure Park, Rivers",
    latitude: 4.8119,
    longitude: 7.0084,
  },
  {
    address: "Wuse 2, Abuja",
    latitude: 9.0765,
    longitude: 7.4896,
  },
];

const eventNames = [
  "Product Design Circle",
  "Frontend Sprint Lab",
  "Founders Breakfast",
  "Career Upgrade Session",
  "Data & AI Meetup",
  "Wedding Reception",
  "Community Prayer Night",
  "Weekend Coding Class",
  "Creative Portfolio Session",
  "Business Growth Seminar",
  "Live Music Party",
  "Graduate Tech Fair",
  "Youth Mentorship Hangout",
  "Public Speaking Workshop",
  "Startup Demo Night",
];

const imagePool = [
  "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1280&q=80",
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1280&q=80",
  "https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=1280&q=80",
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1280&q=80",
  "https://images.unsplash.com/photo-1515169067868-5387ec356754?auto=format&fit=crop&w=1280&q=80",
];

const randomFrom = (list) => list[Math.floor(Math.random() * list.length)];

const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000);
const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const eventStatus = (index) => {
  if (index % 13 === 0) {
    return "draft";
  }

  if (index % 17 === 0) {
    return "cancelled";
  }

  return "published";
};

const recurrenceForIndex = (index, startsAt) => {
  const typeIndex = index % 4;

  if (typeIndex === 0) {
    return {
      type: "none",
      interval: 1,
      daysOfWeek: [],
      dayOfMonth: null,
      weekOfMonth: null,
      weekday: null,
      endsOn: null,
    };
  }

  if (typeIndex === 1) {
    return {
      type: "weekly",
      interval: index % 7 === 0 ? 2 : 1,
      daysOfWeek: [startsAt.getDay()],
      dayOfMonth: null,
      weekOfMonth: null,
      weekday: null,
      endsOn: null,
    };
  }

  if (typeIndex === 2) {
    return {
      type: "monthly-day",
      interval: 1,
      daysOfWeek: [],
      dayOfMonth: startsAt.getDate(),
      weekOfMonth: null,
      weekday: null,
      endsOn: null,
    };
  }

  return {
    type: "monthly-weekday",
    interval: 1,
    daysOfWeek: [],
    dayOfMonth: null,
    weekOfMonth: Math.min(4, Math.ceil(startsAt.getDate() / 7)),
    weekday: startsAt.getDay(),
    endsOn: null,
  };
};

const ticketCode = (index, ticketIndex) =>
  `SEED-${String(index + 1).padStart(2, "0")}-${String(ticketIndex + 1).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const ensureSeedUser = async () => {
  const existing = await User.findOne({ email: "seed.organizer@vera.app" });

  if (existing) {
    return existing;
  }

  const hash = await bcrypt.hash("test12345", 12);

  return User.create({
    fullName: "Vera Seed Organizer",
    email: "seed.organizer@vera.app",
    passwordHash: hash,
    title: "Event Organizer",
    bio: "Seed account for testing Vera events and ticketing.",
  });
};

const ensureWorkspaceMembership = async ({ userId, workspaceId }) => {
  if (!workspaceId) {
    return;
  }

  const existing = await Membership.findOne({ workspaceId, userId });

  if (existing) {
    if (existing.status !== "active" || existing.role === "member") {
      existing.status = "active";
      existing.role = "admin";
      existing.joinedAt = existing.joinedAt || new Date();
      await existing.save();
    }

    return;
  }

  await Membership.create({
    workspaceId,
    userId,
    role: "admin",
    status: "active",
    joinedAt: new Date(),
  });
};

const buildEvents = ({ organizerUserId, workspaceId }) => {
  const start = new Date(now);
  const docs = [];

  for (let index = 0; index < 48; index += 1) {
    const place = randomFrom(locationPool);
    const name = `${randomFrom(eventNames)} ${index + 1}`;

    const startsAt = addHours(addDays(start, index - 6), 8 + (index % 7));
    const endsAt = addHours(startsAt, 2 + (index % 3));
    const paid = index % 3 !== 0;

    docs.push({
      organizerUserId,
      workspaceId: index % 2 === 0 ? workspaceId || null : null,
      name,
      description: `[seed-vera] Demo event ${index + 1} for UI pagination and ticket flow testing.`,
      imageUrl: randomFrom(imagePool),
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      geofenceRadiusMeters: [100, 150, 180, 220][index % 4],
      startsAt,
      endsAt,
      timezone: "Africa/Lagos",
      isPaid: paid,
      ticketPriceNaira: paid ? [3500, 5000, 7500, 12000][index % 4] : 0,
      currency: "NGN",
      expectedTickets: 120 + (index % 6) * 30,
      recurrence: recurrenceForIndex(index, startsAt),
      status: eventStatus(index),
    });
  }

  return docs;
};

const buildTickets = ({ events, organizerUserId, buyerUserId }) => {
  const docs = [];

  events.forEach((event, eventIndex) => {
    const ticketCount = eventIndex % 6;

    for (let ticketIndex = 0; ticketIndex < ticketCount; ticketIndex += 1) {
      const code = ticketCode(eventIndex, ticketIndex);
      const status =
        ticketIndex % 5 === 0
          ? "pending"
          : ticketIndex % 7 === 0
            ? "used"
            : "paid";

      docs.push({
        eventId: event._id,
        workspaceId: event.workspaceId || null,
        organizerUserId,
        buyerUserId,
        quantity: 1,
        unitPriceNaira: Number(event.ticketPriceNaira || 0),
        totalPriceNaira: Number(event.ticketPriceNaira || 0),
        currency: "NGN",
        status,
        paymentProvider: event.isPaid ? "paystack" : "none",
        paymentReference: event.isPaid ? `seed-ref-${eventIndex}-${ticketIndex}` : null,
        attendeeName: "Vera Seed Attendee",
        attendeeEmail: "seed.attendee@vera.app",
        ticketCode: code,
        barcodeValue: JSON.stringify({ provider: "vera", ticketCode: code, eventId: String(event._id) }),
        paidAt: status === "paid" || status === "used" ? new Date() : null,
        verifiedAt: status === "paid" || status === "used" ? new Date() : null,
        usedAt: status === "used" ? new Date() : null,
      });
    }
  });

  return docs;
};

const run = async () => {
  await connectDb();

  const organizer = await ensureSeedUser();
  const workspace = await Workspace.findOne({}).sort({ createdAt: 1 });

  if (workspace) {
    await ensureWorkspaceMembership({ userId: organizer._id, workspaceId: workspace._id });
  }

  const oldSeedEvents = await Event.find({ description: /\[seed-vera\]/i }).select("_id").lean();
  const oldSeedIds = oldSeedEvents.map((item) => item._id);

  if (oldSeedIds.length) {
    await EventTicket.deleteMany({ eventId: { $in: oldSeedIds } });
    await Event.deleteMany({ _id: { $in: oldSeedIds } });
  }

  const createdEvents = await Event.insertMany(
    buildEvents({ organizerUserId: organizer._id, workspaceId: workspace?._id || null }),
  );

  const ticketDocs = buildTickets({
    events: createdEvents,
    organizerUserId: organizer._id,
    buyerUserId: organizer._id,
  });

  if (ticketDocs.length) {
    await EventTicket.insertMany(ticketDocs);
  }

  // eslint-disable-next-line no-console
  console.log(`[seed-events] Created ${createdEvents.length} events and ${ticketDocs.length} tickets`);

  process.exit(0);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[seed-events] Failed", error);
  process.exit(1);
});
