#!/usr/bin/env node

/**
 * Seeds ~20 events spanning today through next Tuesday, scattered across
 * two organizer accounts, deliberately exercising every event feature the
 * schema supports (in the combinations it actually allows — ticket
 * categories and presale/dynamic-pricing are mutually exclusive per
 * createEventSchema's own validation, so this alternates between two
 * "maxed out" archetypes rather than forcing every field on every event):
 *
 *   - "categories" archetype: tiered ticket categories (Regular/VIP/VVIP)
 *     + resale with bids. No presale (blocked by schema when categories
 *     are set) and no dynamic pricing (has no effect on category prices).
 *   - "dynamic" archetype: single base price + dynamic/surge pricing +
 *     presale window + resale with bids — the most simultaneous paid
 *     features the schema allows on one event.
 *   - a couple of plain free events for realistic variety.
 */

const { connectDb } = require("../src/config/db");
const User = require("../src/models/user.model");
const Category = require("../src/models/category.model");
const Workspace = require("../src/models/workspace.model");
const Event = require("../src/models/event.model");
const cloudinary = require("../src/config/cloudinary");
const { createEvent } = require("../src/services/event.service");
const { createEventSchema } = require("../src/validations/event.validation");

const ORGANIZERS = ["ezimorahtobenna@gmail.com", "thewkndprojectsss@gmail.com"];

const VENUES = [
  { address: "Admiralty Way, Lekki Phase 1, Lagos", latitude: 6.4474, longitude: 3.4687, state: "Lagos" },
  { address: "Ozumba Mbadiwe Road, Victoria Island, Lagos", latitude: 6.4311, longitude: 3.4217, state: "Lagos" },
  { address: "Herbert Macaulay Way, Yaba, Lagos", latitude: 6.5152, longitude: 3.3896, state: "Lagos" },
  { address: "Obafemi Awolowo Way, Ikeja, Lagos", latitude: 6.6018, longitude: 3.3515, state: "Lagos" },
  { address: "Port Harcourt Pleasure Park, Rivers", latitude: 4.8119, longitude: 7.0084, state: "Rivers" },
  { address: "Bodija, Ibadan, Oyo", latitude: 7.4123, longitude: 3.9137, state: "Oyo" },
  { address: "Independence Layout, Enugu", latitude: 6.4483, longitude: 7.5077, state: "Enugu" },
  { address: "Wuse 2, Abuja", latitude: 9.0765, longitude: 7.4896, state: "FCT" },
];

// New images for themes the existing Cloudinary pool doesn't cover well.
const NEW_IMAGE_SOURCES = [
  ["https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1280&q=80", "fashion"],
  ["https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=1280&q=80", "arts"],
  ["https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=1280&q=80", "film"],
];

// Reused from the earlier seed-test-events.js / add-images-to-test-events.js batch.
const EXISTING_IMAGE_POOL = {
  tech: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318359/vera/event-covers/id3xasaus8jlbsdwvhhq.jpg",
  comedy: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318360/vera/event-covers/kt5vhgjggb1wggtf5lmm.jpg",
  wellness: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318367/vera/event-covers/w1mn9rril5ceu93jnj6r.jpg",
  nightlife: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318363/vera/event-covers/i1h0nlphbfnrcawhnc4b.jpg",
  education: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318365/vera/event-covers/rmhvtxgetcooci96s9mz.jpg",
  food: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318361/vera/event-covers/g1ebs3pevahmrfmk04yc.jpg",
  sports: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318362/vera/event-covers/y4cqfnwnc19ipipyyfju.jpg",
  business: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318368/vera/event-covers/cuzgnxtzbwrfwd9kjtrz.jpg",
  music: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318358/vera/event-covers/nxupopu834expx47xazg.jpg",
  community: "https://res.cloudinary.com/dgiropjpp/image/upload/v1784318365/vera/event-covers/rmhvtxgetcooci96s9mz.jpg",
};

// [name, categoryName, imageTheme, archetype, venueIndex, dayOffset, hour, durationHours, organizerIndex, useOwnWorkspace]
const EVENTS = [
  ["Lagos Tech Founders Night", "Tech", "tech", "dynamic", 0, 0, 19, 3, 0, true],
  ["Stand-Up Riot Comedy Live", "Comedy", "comedy", "categories", 1, 0, 20, 2, 1, true],
  ["Sunrise Yoga & Sound Bath", "Health & Wellness", "wellness", "free", 2, 1, 7, 2, 0, false],
  ["Amapiano Rooftop Sessions", "Nightlife", "nightlife", "dynamic", 3, 1, 21, 4, 1, true],
  ["Product Design Masterclass", "Education", "education", "categories", 0, 1, 10, 3, 0, true],
  ["Street Food & Craft Beer Fest", "Food", "food", "categories", 4, 2, 12, 6, 1, false],
  ["5-a-Side Football Championship", "Sports", "sports", "dynamic", 5, 2, 15, 4, 0, true],
  ["Runway Lagos: Emerging Designers", "Fashion", "fashion", "categories", 1, 2, 18, 3, 1, true],
  ["Gallery Night: Contemporary Voices", "Arts & Culture", "arts", "dynamic", 2, 3, 17, 3, 0, false],
  ["Founders & Funders Breakfast", "Business", "business", "dynamic", 0, 3, 8, 2, 1, true],
  ["AI & The Future of Work Summit", "Tech", "tech", "categories", 3, 3, 9, 6, 0, true],
  ["Praise & Worship Night", "Community", "community", "free", 6, 4, 18, 3, 1, false],
  ["Silent Disco Under The Stars", "Nightlife", "nightlife", "categories", 1, 4, 20, 4, 0, true],
  ["Open Mic Comedy & Poetry", "Comedy", "comedy", "dynamic", 2, 4, 19, 2, 1, false],
  ["Wine, Jazz & Cigars", "Music", "music", "dynamic", 0, 5, 19, 3, 0, true],
  ["Kids & Family Fun Carnival", "Sports", "sports", "categories", 7, 5, 10, 5, 1, true],
  ["Film Screening: Nollywood Shorts", "Film", "film", "dynamic", 3, 5, 17, 3, 0, false],
  ["Marathon Prep Bootcamp", "Health & Wellness", "wellness", "categories", 5, 6, 7, 3, 1, false],
  ["Startup Demo Day", "Business", "business", "categories", 0, 6, 14, 4, 0, true],
  ["Sunset Boat Cruise Party", "Nightlife", "nightlife", "dynamic", 4, 7, 16, 4, 1, true],
];

const buildTicketCategories = (basePriceNaira) => [
  { name: "Regular", quantity: 60, priceNaira: basePriceNaira, description: "Standard entry" },
  { name: "VIP", quantity: 20, priceNaira: Math.round(basePriceNaira * 2.2), description: "Front-of-venue + fast-track entry" },
  { name: "VVIP", quantity: 8, priceNaira: Math.round(basePriceNaira * 4), description: "Backstage access + dedicated host" },
];

const main = async () => {
  await connectDb();

  const organizers = await Promise.all(ORGANIZERS.map((email) => User.findOne({ email })));

  if (organizers.some((o) => !o)) {
    throw new Error(`Missing organizer account(s): ${ORGANIZERS.filter((_, i) => !organizers[i]).join(", ")}`);
  }

  const workspaces = await Promise.all(
    organizers.map((organizer) => Workspace.findOne({ ownerUserId: organizer._id })),
  );

  const categories = await Category.find().lean();
  const categoryIdByName = new Map(categories.map((c) => [c.name, String(c._id)]));

  const imagePool = { ...EXISTING_IMAGE_POOL };

  console.log(`Uploading ${NEW_IMAGE_SOURCES.length} new images to Cloudinary...`);
  for (const [sourceUrl, theme] of NEW_IMAGE_SOURCES) {
    try {
      const result = await cloudinary.uploader.upload(sourceUrl, {
        folder: "vera/event-covers",
        resource_type: "image",
        overwrite: false,
        unique_filename: true,
      });
      imagePool[theme] = result.secure_url;
      console.log(`  ✓ ${theme}: ${result.secure_url}`);
    } catch (error) {
      console.warn(`  ✗ skipped ${theme} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const now = new Date();
  const created = [];
  const failed = [];

  for (let index = 0; index < EVENTS.length; index += 1) {
    const [
      name,
      categoryName,
      imageTheme,
      archetype,
      venueIndex,
      dayOffset,
      hour,
      durationHours,
      organizerIndex,
      useOwnWorkspace,
    ] = EVENTS[index];

    const venue = VENUES[venueIndex];
    const organizer = organizers[organizerIndex];
    const workspace = workspaces[organizerIndex];

    let startsAt = new Date(now);
    startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
    startsAt.setUTCHours(hour, 0, 0, 0);

    // Guard against landing in the past when dayOffset is 0 (today) and
    // the chosen hour has already passed — push it a few hours ahead.
    if (startsAt.getTime() <= now.getTime()) {
      startsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    }

    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);
    const isPaid = archetype !== "free";
    const usingCategories = archetype === "categories";
    const usingDynamic = archetype === "dynamic";
    const basePriceNaira = isPaid ? [3000, 5000, 7500, 10000][index % 4] : 0;

    const rawPayload = {
      categoryIds: categoryIdByName.get(categoryName) ? [categoryIdByName.get(categoryName)] : undefined,
      name,
      description: `[seed-this-week] ${name} — maxed-out feature demo event (${archetype}).`,
      imageUrl: imagePool[imageTheme] || "",
      address: venue.address,
      state: venue.state,
      latitude: venue.latitude,
      longitude: venue.longitude,
      geofenceRadiusMeters: [100, 150, 200, 250, 300][index % 5],
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isPaid,
      ticketPriceNaira: usingCategories ? 0 : basePriceNaira,
      expectedTickets: usingCategories ? 88 : 60 + (index % 5) * 15,
      ticketCategories: usingCategories ? buildTicketCategories(basePriceNaira) : [],
      workspaceId: useOwnWorkspace && workspace ? String(workspace._id) : undefined,
      pricing: usingDynamic
        ? {
            dynamicEnabled: true,
            minPriceNaira: Math.round(basePriceNaira * 0.7),
            maxPriceNaira: Math.round(basePriceNaira * 1.8),
            demandSensitivity: [1, 1.3, 1.6, 1.8][index % 4],
            discountFloorRatio: 0.75,
            surgeCapRatio: 1.8,
          }
        : undefined,
      sales: usingDynamic
        ? {
            presaleEnabled: true,
            presaleStartsAt: new Date(startsAt.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
            presaleEndsAt: new Date(startsAt.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            presaleQuantity: 15 + (index % 3) * 5,
            presalePriceNaira: Math.round(basePriceNaira * 1.5),
          }
        : undefined,
      resale: isPaid
        ? {
            enabled: true,
            allowBids: true,
            maxMarkupPercent: [20, 25, 30, 35, 40][index % 5],
            bidWindowHours: [6, 12, 18, 24][index % 4],
          }
        : undefined,
      emergency: {
        enabled: true,
        autoAlertsEnabled: true,
        confidenceThreshold: [60, 65, 70, 75, 80][index % 5],
        reportCooldownSeconds: [30, 45, 60, 90][index % 4],
        geofenceRadiusMeters: null,
        sensitivity: [0.8, 1, 1.2, 1.5][index % 4],
      },
      status: "published",
    };

    try {
      const payload = createEventSchema.parse(rawPayload);
      const event = await createEvent({ actorUserId: organizer._id, payload });
      created.push(event);
      console.log(
        `✓ [${archetype}] ${event.name} — ${event.startsAt.toISOString()} — ${ORGANIZERS[organizerIndex]}`,
      );
    } catch (error) {
      failed.push({ name, error: error instanceof Error ? error.message : String(error) });
      console.error(`✗ ${name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\nCreated ${created.length}/${EVENTS.length} events.`);
  if (failed.length) {
    console.log(`${failed.length} failed:`, failed);
  }

  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error("Seed script failed", error);
  process.exit(1);
});
