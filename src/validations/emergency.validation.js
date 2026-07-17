const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");

const emergencyCategorySchema = z.enum([
  "fire",
  "medical",
  "security_threat",
  "structural_collapse",
  "crowd_crush",
  "violence",
  "weather",
  "other",
]);

const submitEmergencyReportSchema = z.object({
  eventId: objectIdSchema,
  ticketId: objectIdSchema,
  category: emergencyCategorySchema,
  description: z.string().trim().max(500).optional().default(""),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  gpsAccuracy: z.coerce.number().min(0).optional(),
  deviceId: z.string().trim().max(120).optional().default(""),
});

const emergencyIdParamsSchema = z.object({
  emergencyId: objectIdSchema,
});

const resolveEmergencySchema = z.object({
  falsePositive: z.boolean().optional().default(false),
  note: z.string().trim().max(500).optional().default(""),
});

const broadcastEmergencySchema = z.object({
  message: z.string().trim().min(1).max(500),
});

module.exports = {
  submitEmergencyReportSchema,
  emergencyIdParamsSchema,
  resolveEmergencySchema,
  broadcastEmergencySchema,
};
