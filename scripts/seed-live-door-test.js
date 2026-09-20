#!/usr/bin/env node

/**
 * Four events that are live right now, each already holding tickets with
 * add-ons on them, for testing the door and desk hand-over by hand.
 *
 * The order matters and is the whole reason this is a script: ticket sales
 * close the moment an event starts, and a door only admits a started event.
 * So each event is created in the near future, sold into, and only then
 * moved to "started an hour ago". A buyer does the same thing by arriving
 * after doors open.
 *
 * Every event is free, so tickets issue instantly without a card. Paid
 * events cannot be seeded this way — their checkout ends at Paystack.
 *
 * Tagged [live-door-test] in the description, so the batch can be removed:
 *   db.events.deleteMany({ description: /\[live-door-test\]/ })
 *
 * Usage: node scripts/seed-live-door-test.js
 */

const { connectDb } = require("../src/config/db");
const mongoose = require("mongoose");
const User = require("../src/models/user.model");
const Category = require("../src/models/category.model");
const Event = require("../src/models/event.model");
const cloudinary = require("../src/config/cloudinary");
const { createEvent } = require("../src/services/event.service");
const { initializeTicketPurchase } = require("../src/services/event.service");
const { createEventSchema } = require("../src/validations/event.validation");

const SEED_TAG = "[live-door-test]";
const ORGANIZER_EMAIL = "ezimorahtobenna@gmail.com";
const HOUR_MS = 60 * 60 * 1000;

const VENUE = {
  address: "Admiralty Way, Lekki Phase 1, Lagos",
  latitude: 6.4474,
  longitude: 3.4687,
  state: "Lagos",
};

const addOn = (name, redemption, extras = {}) => ({
  name,
  priceNaira: 0,
  redemption,
  location: extras.location || "",
  stock: extras.variants ? 0 : 200,
  variants: extras.variants || [],
  maxPerTicket: extras.maxPerTicket || 1,
  transfersOnResale: true,
  active: true,
});

/* Four shapes, so each event proves something different at the door. */
const SCENARIOS = [
  {
    key: "door-only",
    name: "Door Test 1 — Everything at the door",
    proves: "the simple case: two items, both handed over at the gate",
    addOns: [
      addOn("Parking", "door", { location: "Main gate" }),
      addOn("After-party", "door"),
    ],
    tickets: [{ take: ["Parking", "After-party"] }, { take: ["Parking"] }],
  },
  {
    key: "desk-only",
    name: "Door Test 2 — Collected at a desk",
    proves: "desk items, including one with sizes that keep their own stock",
    addOns: [
      addOn("Dinner", "desk", { location: "Dining hall" }),
      addOn("T-shirt", "desk", {
        location: "Merch desk",
        variants: [
          { name: "M", stock: 20 },
          { name: "L", stock: 20 },
        ],
      }),
    ],
    tickets: [
      { take: ["Dinner", "T-shirt:M"] },
      { take: ["T-shirt:L"] },
    ],
  },
  {
    key: "mixed",
    name: "Door Test 3 — Door, desk and nothing to collect",
    proves:
      "the gate shows desk items as locked, and refuses the one that is only printed on the ticket",
    addOns: [
      addOn("Parking", "door", { location: "Main gate" }),
      addOn("Dinner", "desk", { location: "Dining hall" }),
      addOn("Programme booklet", "none"),
    ],
    tickets: [{ take: ["Parking", "Dinner", "Programme booklet"] }],
  },
  {
    key: "partial",
    name: "Door Test 4 — Two of one thing",
    proves:
      "partial collection: hand over one of two and the second stays outstanding",
    addOns: [addOn("Parking", "door", { location: "Main gate", maxPerTicket: 2 })],
    tickets: [{ take: ["Parking x2"] }],
  },
];

const main = async () => {
  await connectDb();

  const organizer = await User.findOne({ email: ORGANIZER_EMAIL });

  if (!organizer) {
    throw new Error(`No organizer account for ${ORGANIZER_EMAIL}`);
  }

  const buyer = await User.findOne({ _id: { $ne: organizer._id } }).sort({
    createdAt: -1,
  });

  if (!buyer) {
    throw new Error("No second account to buy tickets with");
  }

  const categories = await Category.find().lean();
  const category = categories[0];

  let cover = "";

  try {
    const resources = await cloudinary.api.resources({
      type: "upload",
      prefix: "vera/event-covers",
      max_results: 10,
    });
    cover = resources.resources?.[0]?.secure_url || "";
  } catch {
    /* A cover is decoration here; the door flow does not need one. */
  }

  const now = new Date();
  const results = [];

  for (const scenario of SCENARIOS) {
    /* Far enough ahead that sales are open while the tickets are bought. */
    const startsAt = new Date(now.getTime() + 2 * HOUR_MS);
    const endsAt = new Date(now.getTime() + 6 * HOUR_MS);

    const payload = createEventSchema.parse({
      categoryIds: category ? [String(category._id)] : undefined,
      name: scenario.name,
      description: `${SEED_TAG} ${scenario.proves}.`,
      imageUrl: cover || undefined,
      address: VENUE.address,
      state: VENUE.state,
      latitude: VENUE.latitude,
      longitude: VENUE.longitude,
      geofenceRadiusMeters: 300,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isPaid: false,
      ticketPriceNaira: 0,
      expectedTickets: 100,
      ticketCategories: [],
      addOns: scenario.addOns,
      promoCodes: [],
      status: "published",
    });

    const event = await createEvent({ actorUserId: organizer._id, payload });
    const created = await Event.findById(event._id);
    const addOnsById = new Map(
      created.addOns.map((item) => [item.name, item]),
    );

    const tickets = [];

    for (const wanted of scenario.tickets) {
      const selection = wanted.take.map((entry) => {
        const [name, variantOrCount] = entry.split(/[:x]/).map((part) => part.trim());
        const definition = addOnsById.get(name);
        const isCount = /x\s*\d+$/.test(entry);

        return {
          addOnId: String(definition._id),
          quantity: isCount ? Number(variantOrCount) : 1,
          ...(definition.variants?.length ? { variantName: variantOrCount } : {}),
        };
      });

      const purchase = await initializeTicketPurchase({
        eventId: event._id,
        actorUserId: buyer._id,
        payload: { quantity: 1, email: buyer.email, addOns: selection },
      });

      tickets.push({
        code: purchase.ticket.ticketCode,
        items: wanted.take,
      });
    }

    /* Doors open. Sales close with them, which is the real-world order. */
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          startsAt: new Date(Date.now() - HOUR_MS),
          endsAt: new Date(Date.now() + 5 * HOUR_MS),
        },
      },
    );

    results.push({ scenario, eventId: String(event._id), tickets });
    console.log(`✓ ${scenario.name}`);
  }

  console.log("\n────────────────────────────────────────────");
  console.log("Four events, live now. Ticket holder:", buyer.email);
  console.log("Scan these codes in the app: event → Manage → door mode → enter code");
  console.log("────────────────────────────────────────────");

  results.forEach(({ scenario, eventId, tickets }) => {
    console.log(`\n${scenario.name}`);
    console.log(`  proves : ${scenario.proves}`);
    console.log(`  event  : ${eventId}`);
    tickets.forEach((ticket) =>
      console.log(`  ticket : ${ticket.code}  →  ${ticket.items.join(", ")}`),
    );
  });

  await mongoose.disconnect();
  process.exit(0);
};

main().catch(async (error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
