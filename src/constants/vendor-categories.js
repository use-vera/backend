/**
 * Vera's own list of what a vendor can sell.
 *
 * Fixed on purpose: attendees filter by these and organizers search on them,
 * so "Drinks", "drinks" and "Beverages" being three different things would
 * quietly break both. A vendor's own names for things are sections, which are
 * free text and live on the vendor (see vendor.model.js).
 *
 * Adding to this list is safe. Renaming or removing one is a migration: check
 * vendors.categories and vendorItems.category before touching an entry.
 */
const VENDOR_CATEGORIES = Object.freeze([
  "food",
  "drinks",
  "snacks",
  "desserts",
  "clothing_merch",
  "accessories",
  "beauty_grooming",
  "art_crafts",
  "services",
  "other",
]);

/** What each key is called on screen. The API sends both. */
const VENDOR_CATEGORY_LABELS = Object.freeze({
  food: "Food",
  drinks: "Drinks",
  snacks: "Snacks",
  desserts: "Desserts",
  clothing_merch: "Clothing & merch",
  accessories: "Accessories",
  beauty_grooming: "Beauty & grooming",
  art_crafts: "Art & crafts",
  services: "Services",
  other: "Other",
});

const isVendorCategory = (value) => VENDOR_CATEGORIES.includes(String(value));

const vendorCategoryLabel = (value) =>
  VENDOR_CATEGORY_LABELS[String(value)] || "";

/** The shape every client needs to render a picker without hardcoding it. */
const listVendorCategories = () =>
  VENDOR_CATEGORIES.map((key) => ({
    key,
    label: VENDOR_CATEGORY_LABELS[key],
  }));

module.exports = {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  isVendorCategory,
  listVendorCategories,
  vendorCategoryLabel,
};
