const request = require("supertest");
const app = require("../app");
const { createUser, createWorkspace, createApiKey, createEvent } = require("./fixtures");

test("401 unauthorized has the {success:false, error:{code, message}} shape", async () => {
  const response = await request(app).get("/v1/events");

  expect(response.status).toBe(401);
  expect(response.body).toEqual({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: expect.any(String),
    },
  });
});

test("403 missing scope has a MISSING_SCOPE code with a details.missing list", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
    scopes: ["events:read"],
  });

  const response = await request(app)
    .post("/v1/refunds")
    .set("Authorization", `Bearer ${rawSecret}`)
    .send({ ticketId: "507f1f77bcf86cd799439011" });

  expect(response.status).toBe(403);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe("MISSING_SCOPE");
  expect(response.body.error.details.missing).toEqual(["refunds:write"]);
});

test("404 cross-workspace event has NOT_FOUND, not leaking existence via a different code", async () => {
  const owner = await createUser();
  const otherOwner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const { rawSecret } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });
  const event = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
    status: "published",
  });

  const response = await request(app)
    .get(`/v1/events/${event._id}`)
    .set("Authorization", `Bearer ${rawSecret}`);

  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("NOT_FOUND");
});

test("400 validation error on a malformed checkout session body", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  const response = await request(app)
    .post("/v1/checkout/sessions")
    .set("Authorization", `Bearer ${rawSecret}`)
    .send({ eventId: "not-a-valid-id", customerEmail: "not-an-email" });

  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBeDefined();
});

test("an unmatched /v1 route 404s with the v1 envelope shape", async () => {
  const owner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  const { rawSecret } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: owner._id,
  });

  const response = await request(app)
    .get("/v1/nonexistent-endpoint")
    .set("Authorization", `Bearer ${rawSecret}`);

  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("NOT_FOUND");
});
