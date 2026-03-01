const { z } = require("zod");

const dataUriPattern = /^data:[^;]+;base64,[A-Za-z0-9+/=\n\r]+$/;

const uploadAssetSchema = z.object({
  dataUri: z
    .string()
    .trim()
    .min(16)
    .refine((value) => dataUriPattern.test(value), {
      message: "dataUri must be a valid base64 data URI",
    }),
  folder: z.string().trim().min(1).max(80).optional(),
  resourceType: z
    .enum(["image", "video", "raw", "auto"])
    .optional()
    .default("auto"),
});

module.exports = {
  uploadAssetSchema,
};
