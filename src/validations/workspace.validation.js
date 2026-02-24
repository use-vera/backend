const { z } = require("zod");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const workspaceRefRegex = /^([a-fA-F0-9]{24}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const objectIdSchema = z
  .string()
  .regex(objectIdRegex, "Invalid id format");
const workspaceRefSchema = z
  .string()
  .trim()
  .regex(workspaceRefRegex, "Invalid workspace reference");

const geofenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(240),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(5000),
});

const presencePolicySchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(10).max(720).optional(),
  maxConsecutiveMisses: z.number().int().min(1).max(12).optional(),
});

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  geofence: geofenceSchema.optional(),
  presencePolicy: presencePolicySchema.optional(),
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    geofence: geofenceSchema.optional(),
    presencePolicy: presencePolicySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const workspaceParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
});

const joinRequestCreateSchema = z.object({
  message: z.string().trim().max(500).optional(),
});

const joinRequestParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
  requestId: objectIdSchema,
});

const updateMemberRoleParamsSchema = z.object({
  workspaceId: workspaceRefSchema,
  memberId: objectIdSchema,
});

const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(20),
  search: z.string().trim().max(120).optional(),
  role: z.enum(["owner", "admin", "member", "all"]).optional(),
  status: z.enum(["active", "invited", "pending", "rejected", "all"]).optional(),
});

const memberDetailsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(30),
});

const updateMemberRoleBodySchema = z.object({
  role: z.enum(["admin", "member"]),
});

module.exports = {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
  joinRequestCreateSchema,
  joinRequestParamsSchema,
  updateMemberRoleParamsSchema,
  listMembersQuerySchema,
  memberDetailsQuerySchema,
  updateMemberRoleBodySchema,
};
