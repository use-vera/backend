jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  // getCheckoutSession opportunistically calls verifyTicketPayment, which
  // hits this — "pending" (not "success") keeps the ticket unpaid so the
  // opportunistic sync's expected 402 path is exercised instead of a real
  // network call.
  verifyPaystackTransaction: jest.fn().mockResolvedValue({ status: "pending" }),
}));

const {
  createCheckoutSession,
  getCheckoutSession,
} = require("../services/checkout-session.service");
const OrganizerWallet = require("../models/organizer-wallet.model");
const CheckoutSession = require("../models/checkout-session.model");
const User = require("../models/user.model");
const { createUser, createWorkspace, createApiKey, createEvent } = require("./fixtures");

const futureWindow = () => ({
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 27 * 60 * 60 * 1000),
});

test("free event checkout session purchases instantly and credits the organizer wallet", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: false,
    ...futureWindow(),
  });

  const session = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload: { eventId: event._id, quantity: 1, customerEmail: "buyer@example.com" },
  });

  expect(session.status).toBe("purchased");
  expect(session.requiresPayment).toBe(false);
  expect(session.ticketIds).toHaveLength(1);

  const wallet = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
  // Free ticket credits ₦0 — the point of this assertion is that crediting
  // ran at all (a wallet row exists) via the reused purchase pipeline.
  expect(wallet).not.toBeNull();
});

test("paid event checkout session reserves and returns a checkoutUrl", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: true,
    ticketPriceNaira: 5000,
    ...futureWindow(),
  });

  const session = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload: { eventId: event._id, quantity: 2, customerEmail: "buyer2@example.com" },
  });

  expect(session.status).toBe("reserved");
  expect(session.requiresPayment).toBe(true);
  expect(session.checkoutUrl).toBe("https://checkout.paystack.com/mock");
  expect(session.ticketIds).toHaveLength(2);
  expect(session.expiresAt).toBeInstanceOf(Date);

  const fetched = await getCheckoutSession({ workspaceId: workspace._id, sessionId: session.id });
  expect(fetched.status).toBe("reserved");
  expect(fetched.tickets).toHaveLength(2);
});

test("a repeat buyer email across two sessions resolves to the same User", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: false,
    ...futureWindow(),
  });

  const first = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload: { eventId: event._id, quantity: 1, customerEmail: "repeat@example.com" },
  });
  const second = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload: { eventId: event._id, quantity: 1, customerEmail: "Repeat@Example.com" },
  });

  const users = await User.find({ email: "repeat@example.com" });
  expect(users).toHaveLength(1);
  expect(first.ticketIds[0]).not.toBe(second.ticketIds[0]);
});

test("checkout session for an event outside the workspace 404s", async () => {
  const organizer = await createUser();
  const otherOwner = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
    isPaid: false,
    ...futureWindow(),
  });

  await expect(
    createCheckoutSession({
      apiKeyId: apiKey._id,
      workspaceId: workspace._id,
      payload: { eventId: event._id, quantity: 1, customerEmail: "x@example.com" },
    }),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
});

test("missing customerEmail is rejected", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: false,
    ...futureWindow(),
  });

  await expect(
    createCheckoutSession({
      apiKeyId: apiKey._id,
      workspaceId: workspace._id,
      payload: { eventId: event._id, quantity: 1, customerEmail: "" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
});

test("an Idempotency-Key replay returns the original session instead of creating a second one", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: false,
    ...futureWindow(),
  });

  const payload = { eventId: event._id, quantity: 1, customerEmail: "idem@example.com" };
  const first = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload,
    idempotencyKey: "replay-key-1",
  });
  const second = await createCheckoutSession({
    apiKeyId: apiKey._id,
    workspaceId: workspace._id,
    payload,
    idempotencyKey: "replay-key-1",
  });

  expect(second.id).toBe(first.id);
  const count = await CheckoutSession.countDocuments({ apiKeyId: apiKey._id });
  expect(count).toBe(1);
});

test("concurrent checkout sessions against a near-full event don't crash or corrupt state (documented oversell limitation, not asserted fixed)", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const { apiKey } = await createApiKey({
    workspaceId: workspace._id,
    createdByUserId: organizer._id,
  });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    isPaid: false,
    expectedTickets: 3,
    ...futureWindow(),
  });

  // The underlying capacity check + ticket insert in initializeTicketPurchase
  // are not atomic (a pre-existing gap in the shared purchase pipeline,
  // inherited here rather than fixed in this pass — see checkout-session
  // service comments). This test only asserts the system stays consistent
  // under concurrency, NOT that oversell is prevented.
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) =>
      createCheckoutSession({
        apiKeyId: apiKey._id,
        workspaceId: workspace._id,
        payload: {
          eventId: event._id,
          quantity: 1,
          customerEmail: `concurrent${index}@example.com`,
        },
      }),
    ),
  );

  const fulfilled = attempts.filter((result) => result.status === "fulfilled");
  expect(fulfilled.length).toBeGreaterThan(0);

  const sessions = await CheckoutSession.find({ eventId: event._id });
  expect(sessions.length).toBe(fulfilled.length);
});
