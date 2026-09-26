const { z } = require("zod");
const { VENDOR_CATEGORIES } = require("../constants/vendor-categories");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectId = (label) =>
  z.string().trim().regex(objectIdRegex, `Invalid ${label}`);

const categoryEnum = z.enum(VENDOR_CATEGORIES);

/* An https URL or nothing. The client sends back what /api/files returned;
   anything else does not belong in an <img> we render for everyone. */
const imageUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "Image must be an uploaded file URL",
  );

const createVendorBodySchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  categories: z.array(categoryEnum).min(1).max(VENDOR_CATEGORIES.length),
  logoUrl: imageUrl.optional(),
  city: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(32).optional(),
});

const updateVendorBodySchema = z
  .object({
    businessName: z.string().trim().min(2).max(120).optional(),
    categories: z
      .array(categoryEnum)
      .min(1)
      .max(VENDOR_CATEGORIES.length)
      .optional(),
    logoUrl: imageUrl.optional(),
    city: z.string().trim().max(80).optional(),
    contactPhone: z.string().trim().max(32).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

const sectionBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

const sectionIdParamsSchema = z.object({
  sectionId: objectId("section ID"),
});

const reorderSectionsBodySchema = z.object({
  sectionIds: z.array(objectId("section ID")).min(1).max(50),
});

const itemIdParamsSchema = z.object({
  itemId: objectId("item ID"),
});

/* One or the other: a BVN lifts you to verified, a CAC number to registered. */
const submitVerificationBodySchema = z
  .object({
    bvn: z.string().trim().regex(/^\d{11}$/, "A BVN is 11 digits").optional(),
    cacNumber: z.string().trim().min(3).max(40).optional(),
  })
  .refine((body) => Boolean(body.bvn) !== Boolean(body.cacNumber), {
    message: "Send either a BVN or a CAC number",
  });

const reviewVerificationBodySchema = z.object({
  approve: z.coerce.boolean(),
  level: z.enum(["verified", "registered"]).optional(),
  note: z.string().trim().max(300).optional(),
});

const vendorStatusBodySchema = z.object({
  status: z.enum(["active", "suspended"]),
  note: z.string().trim().max(300).optional(),
});

const vendorIdParamsSchema = z.object({
  vendorId: objectId("vendor ID"),
});

const createItemBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: categoryEnum,
  priceNaira: z.coerce.number().int().min(0).max(100_000_000),
  description: z.string().trim().max(400).optional(),
  imageUrl: imageUrl.optional(),
  sectionId: objectId("section ID").nullable().optional(),
  available: z.coerce.boolean().optional(),
  ageRestricted: z.coerce.boolean().optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
});

const updateItemBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: categoryEnum.optional(),
    priceNaira: z.coerce.number().int().min(0).max(100_000_000).optional(),
    description: z.string().trim().max(400).optional(),
    imageUrl: imageUrl.optional(),
    sectionId: objectId("section ID").nullable().optional(),
    available: z.coerce.boolean().optional(),
    ageRestricted: z.coerce.boolean().optional(),
    stock: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

const reorderItemsBodySchema = z.object({
  itemIds: z.array(objectId("item ID")).min(1).max(200),
});

const listVendorsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: categoryEnum.optional(),
  city: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const vendorSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(160),
});

module.exports = {
  createItemBodySchema,
  createVendorBodySchema,
  itemIdParamsSchema,
  listVendorsQuerySchema,
  reorderItemsBodySchema,
  reorderSectionsBodySchema,
  sectionBodySchema,
  sectionIdParamsSchema,
  reviewVerificationBodySchema,
  submitVerificationBodySchema,
  updateItemBodySchema,
  updateVendorBodySchema,
  vendorIdParamsSchema,
  vendorStatusBodySchema,
  vendorSlugParamsSchema,
};
