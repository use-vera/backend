#!/usr/bin/env node

/**
 * Seeds a week of randomised events for manual testing, plus one event that
 * is live RIGHT NOW so the add-on collection flow can be exercised end to
 * end (a door only hands things over to a ticket that can be checked in,
 * which means an event that has already started).
 *
 * Randomised on purpose — venue, timing, pricing archetype, add-ons, promo
 * codes, cover image — because a test set where every event is the same
 * shape only ever proves the one shape works. Images are picked from the
 * folder already in Cloudinary rather than uploaded again, and deliberately
 * left off some events so the "no cover" path gets exercised too.
 *
 * Everything it creates is tagged in the description with SEED_TAG, so the
 * whole batch can be found (and removed) later:
 *
 *   db.events.deleteMany({ description: /\[week-addons\]/ })
 *
 * Usage: node scripts/seed-week-addon-events.js [count]
 */

const { connectDb } = require("../src/config/db");
const User = require("../src/models/user.model");
const Category = require("../src/models/category.model");
const Workspace = require("../src/models/workspace.model");
const cloudinary = require("../src/config/cloudinary");
const { createEvent } = require("../src/services/event.service");
const { createEventSchema } = require("../src/validations/event.validation");

const SEED_TAG = "[week-addons]";
const ORGANIZERS = ["ezimorahtobenna@gmail.com", "thewkndprojectsss@gmail.com"];
const HOUR_MS = 60 * 60 * 1000;

/* A fixed seed so a run is reproducible and the summary printed at the end
   actually describes what is in the database. */
let randomState = 20260920;

const random = () => {
  randomState = (randomState * 1664525 + 1013904223) % 4294967296;
  return randomState / 4294967296;
};

const pick = (items) => items[Math.floor(random() * items.length)];
const pickSome = (items, max) => {
  const wanted = Math.floor(random() * (max + 1));
  const pool = [...items];
  const chosen = [];

  while (chosen.length < wanted && pool.length) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }

  return chosen;
};
const chance = (probability) => random() < probability;
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const VENUES = [
  { address: "Admiralty Way, Lekki Phase 1, Lagos", latitude: 6.4474, longitude: 3.4687, state: "Lagos" },
  { address: "Ozumba Mbadiwe Road, Victoria Island, Lagos", latitude: 6.4311, longitude: 3.4217, state: "Lagos" },
  { address: "Herbert Macaulay Way, Yaba, Lagos", latitude: 6.5152, longitude: 3.3896, state: "Lagos" },
  { address: "Obafemi Awolowo Way, Ikeja, Lagos", latitude: 6.6018, longitude: 3.3515, state: "Lagos" },
  { address: "Port Harcourt Pleasure Park, Rivers", latitude: 4.8119, longitude: 7.0084, state: "Rivers" },
  { address: "Bodija, Ibadan, Oyo", latitude: 7.4123, longitude: 3.9137, state: "Oyo" },
  { address: "Independence Layout, Enugu", latitude: 6.4483, longitude: 7.5077, state: "Enugu" },
  { address: "Wuse 2, Abuja", latitude: 9.0765, longitude: 7.4896, state: "FCT" },
  { address: "Ahmadu Bello Way, Kaduna", latitude: 10.5222, longitude: 7.4383, state: "Kaduna" },
  { address: "Oba Adesida Road, Akure, Ondo", latitude: 7.2526, longitude: 5.1931, state: "Ondo" },
];

const TITLE_PARTS = {
  prefix: ["Afrobeats", "Sunset", "Midnight", "Rooftop", "Campus", "Lagos", "Naija", "Open Air", "Secret", "Grand"],
  middle: ["Jollof", "Amapiano", "Vinyl", "Founders", "Street Food", "Comedy", "Art", "Film", "Fitness", "Gospel", "Tech", "Fashion"],
  suffix: ["Festival", "Night", "Sessions", "Summit", "Brunch", "Party", "Meetup", "Showcase", "Cruise", "Carnival"],
};

/* Each add-on carries the one field that does real work: how it is
   collected. "door" is scanned with the ticket, "desk" is handed over
   separately, "none" just prints on the ticket. */
const ADD_ON_POOL = [
  { name: "Parking", priceNaira: 5000, redemption: "door", location: "Main gate" },
  { name: "After-party", priceNaira: 10000, redemption: "door", location: "" },
  { name: "Dinner", priceNaira: 20000, redemption: "desk", location: "Dining hall" },
  { name: "T-shirt", priceNaira: 15000, redemption: "desk", location: "Merch desk", sized: true },
  { name: "Meet & greet", priceNaira: 50000, redemption: "door", location: "Backstage" },
  { name: "Drinks voucher", priceNaira: 7500, redemption: "desk", location: "Bar" },
  { name: "Programme booklet", priceNaira: 2000, redemption: "none", location: "" },
];

const PROMO_POOL = [
  { name: "Early bird", code: "EARLY", discountType: "percent", discountValue: 10, appliesTo: "ticket" },
  { name: "Students", code: "STUDENT", discountType: "percent", discountValue: 20, appliesTo: "ticket" },
  { name: "Free parking", code: "PARKFREE", discountType: "fixed", discountValue: 5000, appliesTo: "addons" },
  { name: "Launch week", code: "LAUNCH", discountType: "fixed", discountValue: 2500, appliesTo: "ticket" },
  { name: "Bring a friend", code: "PLUSONE", discountType: "percent", discountValue: 15, appliesTo: "ticket" },
];

const buildAddOns = (capacity) =>
  pickSome(ADD_ON_POOL, 4).map((addOn) => {
    const stock = Math.max(5, Math.round(capacity * (0.2 + random() * 0.6)));

    if (addOn.sized) {
      const sizes = ["S", "M", "L", "XL"].slice(0, between(2, 4));

      return {
        name: addOn.name,
        priceNaira: addOn.priceNaira,
        redemption: addOn.redemption,
        location: addOn.location,
        stock: 0,
        variants: sizes.map((size) => ({ name: size, stock: between(3, 30) })),
        maxPerTicket: 1,
        transfersOnResale: chance(0.4),
        active: true,
      };
    }

    return {
      name: addOn.name,
      priceNaira: addOn.priceNaira,
      redemption: addOn.redemption,
      location: addOn.location,
      stock,
      variants: [],
      maxPerTicket: between(1, 2),
      transfersOnResale: chance(0.7),
      active: true,
    };
  });

const buildPromoCodes = (index) =>
  pickSome(PROMO_POOL, 3).map((promo, position) => ({
    name: promo.name,
    /* Unique per event: a code only has to be unique within its own event,
       but a recognisable suffix makes them easy to type while testing. */
    code: `${promo.code}${index}${position}`,
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    appliesTo: promo.appliesTo,
    maxUses: chance(0.5) ? between(5, 100) : 0,
    perUserLimit: 1,
    isPublic: chance(0.6),
    active: true,
  }));

const buildTicketCategories = (basePriceNaira) => [
  { name: "Regular", quantity: between(40, 120), priceNaira: basePriceNaira, description: "Standard entry" },
  { name: "VIP", quantity: between(10, 40), priceNaira: Math.round(basePriceNaira * 2.2), description: "Front of house" },
  ...(chance(0.5)
    ? [{ name: "VVIP", quantity: between(4, 12), priceNaira: Math.round(basePriceNaira * 4), description: "Backstage access" }]
    : []),
];

/** Cover images already in the account, so nothing is uploaded twice. */
const loadCloudinaryImages = async () => {
  try {
    const result = await cloudinary.api.resources({
      type: "upload",
      prefix: "vera/event-covers",
      max_results: 100,
    });

    return (result.resources || []).map((item) => item.secure_url);
  } catch (error) {
    console.warn(
      `Could not list Cloudinary images (${error instanceof Error ? error.message : String(error)}). Seeding without covers.`,
    );
    return [];
  }
};

const main = async () => {
  const args = process.argv.slice(2).filter((item) => item !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");
  const count = Math.max(1, Number(args[0]) || 50);

  await connectDb();

  const organizers = await Promise.all(ORGANIZERS.map((email) => User.findOne({ email })));

  if (organizers.some((organizer) => !organizer)) {
    throw new Error(
      `Missing organizer account(s): ${ORGANIZERS.filter((_, index) => !organizers[index]).join(", ")}`,
    );
  }

  const workspaces = await Promise.all(
    organizers.map((organizer) => Workspace.findOne({ ownerUserId: organizer._id })),
  );
  const categories = await Category.find().lean();
  const images = await loadCloudinaryImages();

  console.log(`Cloudinary covers available: ${images.length}`);

  const now = new Date();
  const created = [];
  const failed = [];

  /* The live one first, and deliberately free: a free event issues its
     ticket immediately, so the add-on collection flow can be driven without
     a card. It started an hour ago, which is what makes check-in legal. */
  const liveVenue = VENUES[0];
  const liveCapacity = 120;
  const specs = [
    {
      name: `Vera Live Test — Add-on Collection ${now.toISOString().slice(11, 16)}`,
      startsAt: new Date(now.getTime() - HOUR_MS),
      endsAt: new Date(now.getTime() + 5 * HOUR_MS),
      venue: liveVenue,
      archetype: "free",
      capacity: liveCapacity,
      imageUrl: images.length ? images[0] : "",
      addOns: [
        { name: "Parking", priceNaira: 0, redemption: "door", location: "Main gate", stock: liveCapacity, variants: [], maxPerTicket: 1, transfersOnResale: true, active: true },
        { name: "Dinner", priceNaira: 0, redemption: "desk", location: "Dining hall", stock: liveCapacity, variants: [], maxPerTicket: 1, transfersOnResale: false, active: true },
        { name: "T-shirt", priceNaira: 0, redemption: "desk", location: "Merch desk", stock: 0, variants: [{ name: "M", stock: 20 }, { name: "L", stock: 20 }], maxPerTicket: 1, transfersOnResale: false, active: true },
        { name: "Programme booklet", priceNaira: 0, redemption: "none", location: "", stock: liveCapacity, variants: [], maxPerTicket: 1, transfersOnResale: true, active: true },
      ],
      promoCodes: [],
      organizerIndex: 0,
      live: true,
    },
  ];

  for (let index = 0; index < count; index += 1) {
    const venue = pick(VENUES);
    const archetype = pick(["categories", "dynamic", "free", "categories", "dynamic"]);
    const capacity = between(40, 400);
    const dayOffset = between(0, 6);
    const hour = pick([8, 10, 12, 14, 16, 18, 19, 20, 21, 22]);
    const startsAt = new Date(now);

    startsAt.setDate(startsAt.getDate() + dayOffset);
    startsAt.setHours(hour, pick([0, 15, 30, 45]), 0, 0);

    /* Today's earlier slots have already gone; push them past now rather
       than creating an event nobody can buy into. */
    const safeStart =
      startsAt.getTime() <= now.getTime() + HOUR_MS
        ? new Date(now.getTime() + between(2, 10) * HOUR_MS)
        : startsAt;

    specs.push({
      name: `${pick(TITLE_PARTS.prefix)} ${pick(TITLE_PARTS.middle)} ${pick(TITLE_PARTS.suffix)} #${index + 1}`,
      startsAt: safeStart,
      endsAt: new Date(safeStart.getTime() + between(2, 8) * HOUR_MS),
      venue,
      archetype,
      capacity,
      /* Roughly two in three carry a cover, so the placeholder path is
         exercised by the rest. */
      imageUrl: images.length && chance(0.65) ? pick(images) : "",
      addOns: buildAddOns(capacity),
      promoCodes: buildPromoCodes(index + 1),
      organizerIndex: between(0, ORGANIZERS.length - 1),
      live: false,
    });
  }

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const organizer = organizers[spec.organizerIndex];
    const workspace = workspaces[spec.organizerIndex];
    const isPaid = spec.archetype !== "free";
    const usingCategories = spec.archetype === "categories";
    const usingDynamic = spec.archetype === "dynamic";
    const basePriceNaira = isPaid ? pick([2500, 3000, 5000, 7500, 10000, 15000]) : 0;
    const category = categories.length ? pick(categories) : null;

    const rawPayload = {
      categoryIds: category ? [String(category._id)] : undefined,
      name: spec.name,
      description: `${SEED_TAG} ${spec.name} — randomised test event (${spec.archetype}).`,
      imageUrl: spec.imageUrl || undefined,
      address: spec.venue.address,
      state: spec.venue.state,
      latitude: spec.venue.latitude,
      longitude: spec.venue.longitude,
      geofenceRadiusMeters: pick([100, 150, 200, 250, 300]),
      startsAt: spec.startsAt.toISOString(),
      endsAt: spec.endsAt.toISOString(),
      isPaid,
      ticketPriceNaira: usingCategories ? 0 : basePriceNaira,
      /* Categories decide the real capacity, but the schema still wants a
         number here, so the draft capacity rides along either way. */
      expectedTickets: spec.capacity,
      ticketCategories: usingCategories ? buildTicketCategories(basePriceNaira) : [],
      addOns: spec.addOns,
      promoCodes: spec.promoCodes,
      workspaceId: workspace && chance(0.7) ? String(workspace._id) : undefined,
      pricing: usingDynamic
        ? {
            dynamicEnabled: true,
            minPriceNaira: Math.round(basePriceNaira * 0.7),
            maxPriceNaira: Math.round(basePriceNaira * 1.8),
            demandSensitivity: pick([1, 1.3, 1.6, 1.8]),
            discountFloorRatio: 0.75,
            surgeCapRatio: 1.8,
          }
        : undefined,
      /* Presale only rides the dynamic archetype: the schema refuses it
         alongside ticket categories. */
      sales:
        usingDynamic && chance(0.6)
          ? {
              presaleEnabled: true,
              presaleStartsAt: new Date(Math.min(now.getTime() - HOUR_MS, spec.startsAt.getTime() - 6 * 24 * HOUR_MS)).toISOString(),
              presaleEndsAt: new Date(spec.startsAt.getTime() - 2 * HOUR_MS).toISOString(),
              presaleQuantity: between(10, 40),
              presalePriceNaira: Math.round(basePriceNaira * 1.5),
            }
          : undefined,
      resale: isPaid
        ? {
            enabled: chance(0.8),
            allowBids: chance(0.6),
            maxMarkupPercent: pick([0, 10, 20, 25, 30, 40]),
            bidWindowHours: pick([6, 12, 18, 24]),
          }
        : undefined,
      status: "published",
    };

    try {
      const payload = createEventSchema.parse(rawPayload);

      if (dryRun) {
        console.log(`· would create ${spec.name} (${spec.archetype})`);
        created.push({
          id: "(dry-run)",
          name: spec.name,
          startsAt: spec.startsAt,
          live: spec.live,
          addOns: spec.addOns.length,
          promoCodes: spec.promoCodes.length,
          hasImage: Boolean(spec.imageUrl),
          archetype: spec.archetype,
        });
        continue;
      }

      const event = await createEvent({ actorUserId: organizer._id, payload });

      created.push({
        id: String(event._id),
        name: event.name,
        startsAt: event.startsAt,
        live: spec.live,
        addOns: spec.addOns.length,
        promoCodes: spec.promoCodes.length,
        hasImage: Boolean(spec.imageUrl),
        archetype: spec.archetype,
      });

      console.log(
        `✓ ${spec.live ? "[LIVE NOW] " : ""}${event.name} — ${event.startsAt.toISOString()} — ${spec.archetype} — ${spec.addOns.length} add-ons, ${spec.promoCodes.length} codes${spec.imageUrl ? "" : ", no cover"}`,
      );
    } catch (error) {
      failed.push({ name: spec.name, error: error instanceof Error ? error.message : String(error) });
      console.error(`✗ ${spec.name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const live = created.find((item) => item.live);

  console.log(`\nCreated ${created.length}/${specs.length} events.`);
  console.log(`  with a cover image : ${created.filter((item) => item.hasImage).length}`);
  console.log(`  without one        : ${created.filter((item) => !item.hasImage).length}`);
  console.log(`  with add-ons       : ${created.filter((item) => item.addOns > 0).length}`);
  console.log(`  with promo codes   : ${created.filter((item) => item.promoCodes > 0).length}`);

  if (live) {
    console.log(`\nLive test event: ${live.name}\n  id: ${live.id}`);
  }

  if (failed.length) {
    console.log(`\n${failed.length} failed:`);
    failed.forEach((item) => console.log(`  ${item.name}: ${item.error}`));
  }

  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error("Seed script failed", error);
  process.exit(1);
});
