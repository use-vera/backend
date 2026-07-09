const request = require("supertest");
const app = require("../app");
const {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} = require("../services/api-key.service");
const Membership = require("../models/membership.model");
const { createUser, createWorkspace } = require("./fixtures");

test("workspace owner can create and list API keys", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });

  const created = await createApiKey({
    workspaceRef: String(workspace._id),
    actorUserId: owner._id,
    label: "My integration",
    mode: "live",
    scopes: ["events:read", "checkout:write"],
  });

  expect(created.secretKey).toMatch(/^sk_live_/);
  expect(created.publishableKey).toMatch(/^pk_live_/);
  expect(created.secretKeyHash).toBeUndefined();

  const keys = await listApiKeys({
    workspaceRef: String(workspace._id),
    actorUserId: owner._id,
  });

  expect(keys).toHaveLength(1);
  expect(keys[0].secretKeyHash).toBeUndefined();
  expect(keys[0].secretKeyLastFour).toHaveLength(4);
});

test("a plain member cannot create an API key", async () => {
  const owner = await createUser();
  const member = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  await Membership.create({
    workspaceId: workspace._id,
    userId: member._id,
    role: "member",
    status: "active",
  });

  await expect(
    createApiKey({
      workspaceRef: String(workspace._id),
      actorUserId: member._id,
      mode: "live",
      scopes: ["events:read"],
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("a revoked key immediately fails subsequent /v1 auth", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });

  const created = await createApiKey({
    workspaceRef: String(workspace._id),
    actorUserId: owner._id,
    mode: "live",
    scopes: ["events:read"],
  });

  const before = await request(app)
    .get("/v1/events")
    .set("Authorization", `Bearer ${created.secretKey}`);
  expect(before.status).toBe(200);

  await revokeApiKey({
    workspaceRef: String(workspace._id),
    actorUserId: owner._id,
    keyId: created._id,
  });

  const after = await request(app)
    .get("/v1/events")
    .set("Authorization", `Bearer ${created.secretKey}`);
  expect(after.status).toBe(401);
});
