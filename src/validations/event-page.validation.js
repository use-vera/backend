const { z } = require("zod");

const blockSchema = z.object({
  id: z.string().trim().min(1).max(40),
  type: z.enum([
    "hero", "text", "lineup", "gallery", "video", "faq", "sponsors",
    "tickets", "venue", "countdown", "organizer", "reviews", "resale",
    "progress", "phase", "footer",
  ]),
  // Block props vary by type and are the organizer's own content; the shape is
  // enforced by the renderer, which ignores anything it does not know.
  props: z.record(z.string(), z.unknown()).optional().default({}),
});

const saveEventPageSchema = z
  .object({
    slug: z.string().trim().max(60).optional(),
    theme: z
      .object({
        preset: z.enum(["paper", "midnight", "ink", "sun", "noir", "forest", "plum", "ocean", "bloom", "slate", "sand", "mint"]).optional(),
        accent: z.string().trim().max(20).optional(),
        // "serif" and "grotesk" are the pre-pairing names. Pages saved under them
        // still round-trip; the service maps them on the way in.
        font: z
          .enum(["gilroy", "editorial", "poster", "brutal", "soft", "club", "modern", "classic", "condensed", "quirky", "statement", "humanist", "serif", "grotesk"])
          .optional(),
      })
      .optional(),
    blocks: z.array(blockSchema).max(40).optional(),
    seo: z
      .object({
        title: z.string().trim().max(120).optional(),
        description: z.string().trim().max(300).optional(),
        imageUrl: z.string().trim().max(600).optional(),
        indexable: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to save",
  });

const setPageStatusSchema = z.object({
  status: z.enum(["draft", "published"]),
});

const slugQuerySchema = z.object({
  slug: z.string().trim().min(1).max(60),
});

const publicSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(60),
});

module.exports = {
  saveEventPageSchema,
  setPageStatusSchema,
  slugQuerySchema,
  publicSlugParamsSchema,
};
