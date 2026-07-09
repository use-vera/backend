const request = require("supertest");
const app = require("../app");
const { createUser, createWorkspace, createApiKey } = require("./fixtures");
const ApiKey = require("../models/api-key.model");

test("a valid secret key authenticates and can list events", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  const response = await request(app)
    .get("/v1/events")
    .set("Authorization", `Bearer ${rawSecret}`);

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(Array.isArray(response.body.data)).toBe(true);
});

test("a valid publishable key can read events but not create a checkout session", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { publishableKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  const readResponse = await request(app)
    .get("/v1/events")
    .set("Authorization", `Bearer ${publishableKey}`);
  expect(readResponse.status).toBe(200);

  // Capped to read-only regardless of what scopes are stored on the row —
  // defense in depth for a key type meant to be embeddable client-side.
  const writeResponse = await request(app)
    .post("/v1/checkout/sessions")
    .set("Authorization", `Bearer ${publishableKey}`)
    .send({ eventId: "507f1f77bcf86cd799439011", customerEmail: "a@example.com" });

  expect(writeResponse.status).toBe(403);
  expect(writeResponse.body.error.code).toBe("MISSING_SCOPE");
});

test("a revoked key is rejected", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret, apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  await ApiKey.updateOne({ _id: apiKey._id }, { $set: { status: "revoked" } });

  const response = await request(app)
    .get("/v1/events")
    .set("Authorization", `Bearer ${rawSecret}`);

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe("UNAUTHORIZED");
});

test("a malformed key is rejected", async () => {
  const response = await request(app)
    .get("/v1/events")
    .set("Authorization", "Bearer not-a-real-key");

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe("UNAUTHORIZED");
});

test("missing Authorization header is rejected", async () => {
  const response = await request(app).get("/v1/events");

  expect(response.status).toBe(401);
  expect(response.body.success).toBe(false);
});

test("lastUsedAt updates after a successful request", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret, apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  expect(apiKey.lastUsedAt).toBeNull();

  await request(app).get("/v1/events").set("Authorization", `Bearer ${rawSecret}`);
  // lastUsedAt update is fire-and-forget — give it a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const refreshed = await ApiKey.findById(apiKey._id);
  expect(refreshed.lastUsedAt).not.toBeNull();
});
