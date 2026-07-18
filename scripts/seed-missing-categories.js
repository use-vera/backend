#!/usr/bin/env node

/**
 * The category icon taxonomy (backend/src/validations/category.validation.js
 * CATEGORY_ICON_KEYS, mirrored on web in web/lib/category-icons.ts) already
 * defines 14 icon keys, but only 6 have an actual Category document. This
 * fills in the rest — chosen to match what real event platforms (Luma,
 * Shows.NG, PartyVerse) actually use as top-level categories.
 */

const { connectDb } = require("../src/config/db");
const { createCategory } = require("../src/services/category.service");
const Category = require("../src/models/category.model");

const NEW_CATEGORIES = [
  { name: "Business", iconKey: "business", description: "Conferences, networking, and corporate events" },
  { name: "Arts & Culture", iconKey: "arts", description: "Exhibitions, theatre, and creative showcases" },
  { name: "Film", iconKey: "film", description: "Screenings, premieres, and film festivals" },
  { name: "Education", iconKey: "education", description: "Workshops, classes, and learning sessions" },
  { name: "Health & Wellness", iconKey: "health", description: "Fitness, yoga, and wellness gatherings" },
  { name: "Community", iconKey: "community", description: "Social hangouts, celebrations, and meetups" },
  { name: "Fashion", iconKey: "fashion", description: "Runway shows, pop-ups, and style events" },
  { name: "Other", iconKey: "other", description: "Everything else" },
];

const main = async () => {
  await connectDb();

  const existing = await Category.find().select("name sortOrder").lean();
  const existingNames = new Set(existing.map((item) => item.name.toLowerCase()));
  const nextSortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder || 0), 0) + 1;

  let created = 0;

  for (let index = 0; index < NEW_CATEGORIES.length; index += 1) {
    const category = NEW_CATEGORIES[index];

    if (existingNames.has(category.name.toLowerCase())) {
      // eslint-disable-next-line no-console
      console.log(`- skipped (already exists): ${category.name}`);
      continue;
    }

    await createCategory({
      name: category.name,
      iconKey: category.iconKey,
      description: category.description,
      sortOrder: nextSortOrder + index,
    });
    created += 1;
    // eslint-disable-next-line no-console
    console.log(`✓ created: ${category.name}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone. Created ${created}/${NEW_CATEGORIES.length} new categories.`);
  process.exit(0);
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Category seeding failed", error);
  process.exit(1);
});
