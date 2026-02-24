const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const objectIdSchema = z
  .string()
  .regex(objectIdRegex, "Invalid id format");

const createWorkspaceInviteSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase().trim()),
  role: z.enum(["member", "admin"]).default("member"),
  message: z.string().trim().max(500).optional(),
});

const inviteParamsSchema = z.object({
  inviteId: objectIdSchema,
});

module.exports = {
  createWorkspaceInviteSchema,
  inviteParamsSchema,
};
