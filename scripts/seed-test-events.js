#!/usr/bin/env node

/**
 * One-off seed script for manually testing event flows (cancellation,
 * refunds, notifications, categories, dynamic pricing) — creates a spread
 * of events for a specific organizer across a fixed date window via the
 * real createEvent service (so validation/defaults/derived fields match
 * production exactly, not a hand-rolled raw insert).
 */

const { connectDb } = require("../src/config/db");
const User = require("../src/models/user.model");
const Category = require("../src/models/category.model");
const { createEvent } = require("../src/services/event.service");
const { createEventSchema } = require("../src/validations/event.validation");

const ORGANIZER_EMAIL = "ezimorahtobenna@gmail.com";

// today (17th) through Monday (20th)
const DAY_KEYS = ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"];

const locationPool = [
  { address: "Admiralty Way, Lekki Phase 1, Lagos", latitude: 6.4474, longitude: 3.4687, state: "Lagos" },
  { address: "Ozumba Mbadiwe Road, Victoria Island, Lagos", latitude: 6.4311, longitude: 3.4217, state: "Lagos" },
  { address: "University of Lagos, Akoka, Lagos", latitude: 6.5152, longitude: 3.3896, state: "Lagos" },
  { address: "Obafemi Awolowo Way, Ikeja, Lagos", latitude: 6.6018, longitude: 3.3515, state: "Lagos" },
  { address: "Port Harcourt Pleasure Park, Rivers", latitude: 4.8119, longitude: 7.0084, state: "Rivers" },
  { address: "Wuse 2, Abuja", latitude: 9.0765, longitude: 7.4896, state: "FCT" },
  { address: "Bodija, Ibadan, Oyo", latitude: 7.4123, longitude: 3.9137, state: "Oyo" },
  { address: "Independence Layout, Enugu", latitude: 6.4483, longitude: 7.5077, state: "Enugu" },
];

// [name, categoryName, isPaid]
const EVENT_TYPES = [
  ["Sunrise Yoga & Wellness", "Sports", false],
  ["Product Design Circle", "Tech", true],
  ["Live Acoustic Night", "Music", true],
  ["Stand-Up Comedy Showcase", "Comedy", true],
  ["Founders Breakfast", "Tech", false],
  ["Street Food Festival", "Food", true],
  ["Amateur Football 5-a-side", "Sports", false],
  ["Rooftop Afrobeats Party", "Nightlife", true],
  ["Frontend Sprint Lab", "Tech", true],
  ["Open Mic Poetry Night", "Music", false],
  ["Wine & Cheese Tasting", "Food", true],
  ["Weekend Karting Championship", "Sports", true],
  ["Startup Demo Night", "Tech", true],
  ["Jazz Under The Stars", "Music", true],
  ["Community Comedy Jam", "Comedy", false],
  ["Late Night DJ Set", "Nightlife", true],
  ["Small Chops & Cocktails Mixer", "Food", true],
  ["Beach Volleyball Tournament", "Sports", true],
  ["Creative Portfolio Session", "Tech", false],
  ["Live Band Reunion Show", "Music", true],
  ["Improv Comedy Battle", "Comedy", true],
  ["Sunday Brunch & Chill", "Food", false],
  ["Techno Warehouse Night", "Nightlife", true],
  ["Career Upgrade Session", "Tech", false],
  ["Kids & Family Fun Fair", "Sports", true],
  ["Praise Night Concert", "Music", false],
  ["Chess & Board Games Meetup", "Sports", false],
  ["Grill & Chill Cookout", "Food", true],
  ["Fashion Pop-Up Showcase", "Nightlife", true],
  ["Data & AI Meetup", "Tech", true],
  ["Roast Battle Comedy Night", "Comedy", true],
  ["Sunset Boat Cruise Party", "Nightlife", true],
  ["Marathon Training Bootcamp", "Sports", false],
  ["Vinyl & Coffee Listening Session", "Music", true],
];

const randomFrom = (list) => list[Math.floor(Math.random() * list.length)];

const buildStartsAt = (dayKey, hour) => new Date(`${dayKey}T${String(hour).padStart(2, "0")}:00:00.000Z`);

const buildTicketCategories = () => [
  { name: "Regular", quantity: 60, priceNaira: 5000, description: "Standard entry" },
  { name: "VIP", quantity: 20, priceNaira: 15000, description: "Front row + swag bag" },
  { name: "VVIP", quantity: 8, priceNaira: 30000, description: "Backstage access + meet & greet" },
];

const main = async () => {
  await connectDb();

  const organizer = await User.findOne({ email: ORGANIZER_EMAIL });

  if (!organizer) {
    throw new Error(`No user found with email ${ORGANIZER_EMAIL}`);
  }

  const categories = await Category.find().lean();
  const categoryByName = new Map(categories.map((item) => [item.name, String(item._id)]));

  const created = [];
  const failed = [];

  for (let index = 0; index < EVENT_TYPES.length; index += 1) {
    const [baseName, categoryName, isPaid] = EVENT_TYPES[index];
    const place = randomFrom(locationPool);
    const dayKey = DAY_KEYS[index % DAY_KEYS.length];
    const hour = 8 + (index % 12); // spread across 8am - 7pm
    const startsAt = buildStartsAt(dayKey, hour);
    const endsAt = new Date(startsAt.getTime() + (2 + (index % 3)) * 60 * 60 * 1000);

    const usingCategories = isPaid && index % 3 === 0;
    const useDynamicPricing = isPaid && !usingCategories && index % 4 === 1;
    const categoryId = categoryByName.get(categoryName);

    const rawPayload = {
      categoryIds: categoryId ? [categoryId] : undefined,
      name: `${baseName} ${dayKey.slice(-2)}/07`,
      description: `[seed-test-events] Test event generated for manual QA (cancellation/refund/notification flows).`,
      imageUrl: "",
      address: place.address,
      state: place.state,
      latitude: place.latitude,
      longitude: place.longitude,
      geofenceRadiusMeters: [100, 150, 200, 250][index % 4],
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isPaid,
      ticketPriceNaira: isPaid && !usingCategories ? [3000, 5000, 7500, 10000][index % 4] : 0,
      expectedTickets: usingCategories ? 88 : 40 + (index % 5) * 20,
      ticketCategories: usingCategories ? buildTicketCategories() : [],
      pricing: useDynamicPricing
        ? {
            dynamicEnabled: true,
            minPriceNaira: 2500,
            maxPriceNaira: 9000,
            demandSensitivity: 1.2,
            discountFloorRatio: 0.8,
            surgeCapRatio: 1.6,
          }
        : undefined,
      status: "published",
    };

    try {
      const payload = createEventSchema.parse(rawPayload);
      const event = await createEvent({ actorUserId: organizer._id, payload });
      created.push({
        name: event.name,
        startsAt: event.startsAt,
        isPaid: event.isPaid,
        usingCategories,
        dynamicPricing: useDynamicPricing,
      });
      // eslint-disable-next-line no-console
      console.log(`✓ ${event.name} — ${event.startsAt.toISOString()}`);
    } catch (error) {
      failed.push({ name: rawPayload.name, error: error instanceof Error ? error.message : String(error) });
      // eslint-disable-next-line no-console
      console.error(`✗ ${rawPayload.name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\nCreated ${created.length}/${EVENT_TYPES.length} events for ${ORGANIZER_EMAIL}.`);

  if (failed.length) {
    // eslint-disable-next-line no-console
    console.log(`${failed.length} failed:`, failed);
  }

  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Seed script failed", error);
  process.exit(1);
});
