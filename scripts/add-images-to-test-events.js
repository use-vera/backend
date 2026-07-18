#!/usr/bin/env node

/**
 * Uploads a themed pool of stock photos through Cloudinary (so we get real
 * res.cloudinary.com URLs — the only host the web app's next/image will
 * render, per web/components/event-thumbnail.tsx) and assigns them across
 * the events created by seed-test-events.js.
 */

const { connectDb } = require("../src/config/db");
const cloudinary = require("../src/config/cloudinary");
const Event = require("../src/models/event.model");

// [source url, theme keyword — used to match against event names]
const IMAGE_SOURCES = [
  ["https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1280&q=80", "music"],
  ["https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=1280&q=80", "tech"],
  ["https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&w=1280&q=80", "comedy"],
  ["https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1280&q=80", "food"],
  ["https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1280&q=80", "sports"],
  ["https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1280&q=80", "nightlife"],
  ["https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1280&q=80", "meetup"],
  ["https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1280&q=80", "party"],
  ["https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1280&q=80", "wellness"],
  ["https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1280&q=80", "startup"],
];

const THEME_KEYWORDS = {
  music: ["acoustic", "jazz", "vinyl", "band", "praise"],
  tech: ["design", "frontend", "data", "ai", "founders", "career", "portfolio"],
  comedy: ["comedy", "stand-up", "improv", "roast"],
  food: ["food", "wine", "brunch", "grill", "chops"],
  sports: ["football", "volleyball", "karting", "marathon", "chess", "fun fair"],
  nightlife: ["afrobeats", "dj", "techno", "boat cruise", "fashion"],
  wellness: ["yoga"],
};

const pickThemeForEvent = (name) => {
  const lower = name.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return theme;
    }
  }
  return "meetup";
};

const main = async () => {
  await connectDb();

  // eslint-disable-next-line no-console
  console.log(`Uploading ${IMAGE_SOURCES.length} images to Cloudinary...`);

  const uploadedByTheme = {};

  for (const [sourceUrl, theme] of IMAGE_SOURCES) {
    try {
      const result = await cloudinary.uploader.upload(sourceUrl, {
        folder: "vera/event-covers",
        resource_type: "image",
        overwrite: false,
        unique_filename: true,
      });
      uploadedByTheme[theme] = uploadedByTheme[theme] || [];
      uploadedByTheme[theme].push(result.secure_url);
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${theme}: ${result.secure_url}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`  ✗ skipped ${theme} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const fallbackPool = Object.values(uploadedByTheme).flat();

  const events = await Event.find({ description: /seed-test-events/ }).select("name");
  // eslint-disable-next-line no-console
  console.log(`\nAssigning images to ${events.length} events...`);

  let updated = 0;

  for (const event of events) {
    const theme = pickThemeForEvent(event.name);
    const pool = uploadedByTheme[theme] && uploadedByTheme[theme].length ? uploadedByTheme[theme] : fallbackPool;
    const imageUrl = pool[updated % pool.length];

    await Event.updateOne({ _id: event._id }, { $set: { imageUrl } });
    updated += 1;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${event.name} -> ${theme}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone. Updated ${updated} events with Cloudinary-hosted images.`);
  process.exit(0);
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Image seeding failed", error);
  process.exit(1);
});
