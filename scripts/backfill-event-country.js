#!/usr/bin/env node

const { connectDb } = require("../src/config/db");
const Event = require("../src/models/event.model");

/**
 * Re-saves every event so the model's pre("validate") hook derives its
 * `country` field (and re-derives `location`, as a harmless side effect)
 * from the existing latitude/longitude. Idempotent — safe to re-run. Run
 * once after the Event.country field is deployed, before relying on the
 * country filter or the /events/countries endpoint.
 */
const run = async () => {
  await connectDb();

  const cursor = Event.find({}).cursor();
  let updated = 0;

  for await (const event of cursor) {
    event.markModified("latitude");
    await event.save({ validateModifiedOnly: true });
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`[backfill-event-country] Updated ${updated} events`);
  process.exit(0);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[backfill-event-country] Failed", error);
  process.exit(1);
});
