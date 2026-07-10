#!/usr/bin/env node

const { connectDb } = require("../src/config/db");
const Event = require("../src/models/event.model");

/**
 * Re-saves every event so the model's pre("validate") hook derives its
 * GeoJSON `location` field from the existing latitude/longitude. Idempotent
 * — safe to re-run. Run once after the Event.location field is deployed,
 * before relying on any near-me ($geoWithin) query.
 */
const run = async () => {
  await connectDb();

  const cursor = Event.find({}).cursor();
  let updated = 0;

  for await (const event of cursor) {
    event.location = {
      type: "Point",
      coordinates: [event.longitude, event.latitude],
    };
    await event.save({ validateModifiedOnly: true });
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`[backfill-event-geo-location] Updated ${updated} events`);
  process.exit(0);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[backfill-event-geo-location] Failed", error);
  process.exit(1);
});
