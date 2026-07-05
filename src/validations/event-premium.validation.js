const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date value",
  });

const eventExportParamsSchema = z.object({
  eventId: objectIdSchema,
  exportId: objectIdSchema,
});

const listEventExportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createEventExportSchema = z
  .object({
    kind: z.enum(["tickets", "attendees", "finance"]),
    format: z.enum(["csv", "json"]).optional().default("csv"),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(
    (value) =>
      (value.from === undefined && value.to === undefined) ||
      (value.from !== undefined && value.to !== undefined),
    {
      message: "Provide both from and to dates together",
      path: ["from"],
    },
  );

module.exports = {
  eventExportParamsSchema,
  listEventExportsQuerySchema,
  createEventExportSchema,
};
