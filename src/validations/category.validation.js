const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");

// Single source of truth for category icons. Each key must have a matching
// entry in both clients' icon maps (mobile: shared/constants/category-icons.ts,
// web: web/lib/category-icons.ts) — adding a key here without updating both
// client maps means that icon silently falls back to "other" on old clients.
const CATEGORY_ICON_KEYS = [
  "music",
  "sports",
  "comedy",
  "business",
  "nightlife",
  "arts",
  "food",
  "film",
  "education",
  "health",
  "community",
  "tech",
  "fashion",
  "other",
];

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  iconKey: z.enum(CATEGORY_ICON_KEYS),
  description: z.string().trim().max(200).optional().default(""),
  sortOrder: z.coerce.number().int().optional().default(0),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  iconKey: z.enum(CATEGORY_ICON_KEYS).optional(),
  description: z.string().trim().max(200).optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

const categoryParamsSchema = z.object({
  categoryId: objectIdSchema,
});

const listCategoriesQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false),
});

module.exports = {
  CATEGORY_ICON_KEYS,
  createCategorySchema,
  updateCategorySchema,
  categoryParamsSchema,
  listCategoriesQuerySchema,
};
