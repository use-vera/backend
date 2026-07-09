const { z } = require("zod");
const { ALL_SCOPES } = require("../config/api-scopes");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id format");
const workspaceRefSchema = z
  .string()
  .trim()
  .regex(workspaceRefRegex, "Invalid workspace reference");

const scopesSchema = z
  .array(z.enum(ALL_SCOPES))
  .min(1, "At least one scope is required");

const apiKeyParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
  keyId: objectIdSchema,
});

const workspaceApiKeyParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
});

const createApiKeySchema = z.object({
  label: z.string().trim().max(80).optional(),
  mode: z.enum(["live", "test"]).default("test"),
  scopes: scopesSchema,
});

const updateApiKeySchema = z
  .object({
    label: z.string().trim().max(80).optional(),
    scopes: scopesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

module.exports = {
  apiKeyParamsSchema,
  workspaceApiKeyParamsSchema,
  createApiKeySchema,
  updateApiKeySchema,
};
