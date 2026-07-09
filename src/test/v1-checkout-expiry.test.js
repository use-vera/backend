jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
}));

const { createCheckoutSession } = require("../services/checkout-session.service");
const {
  runCheckoutSessionMonitorTick,
} = require("../services/checkout-session-monitor.service");
const CheckoutSession = require("../models/checkout-session.model");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createWorkspace, createApiKey, createEvent } = require("./fixtures");

const futureWindow = () => ({
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 27 * 60 * 60 * 1000),
});

const setupReservedSession = async () => {
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
    payload: { eventId: event._id, quantity: 1, customerEmail: "expiring@example.com" },
  });

  return { session };
};

test("a stale reserved session expires and its underlying ticket is cancelled", async () => {
  const { session } = await setupReservedSession();

  await CheckoutSession.updateOne(
    { _id: session.id },
    { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } },
  );

  await runCheckoutSessionMonitorTick();

  const refreshedSession = await CheckoutSession.findById(session.id);
  expect(refreshedSession.status).toBe("expired");

  const ticket = await EventTicket.findById(session.ticketIds[0]);
  expect(ticket.status).toBe("cancelled");
  expect(ticket.paymentMetadata.cancelReason).toBe("checkout_session_expired");
});

test("a session whose ticket paid between scan and processing resolves purchased, not expired", async () => {
  const { session } = await setupReservedSession();

  await CheckoutSession.updateOne(
    { _id: session.id },
    { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } },
  );
  // Simulate a webhook landing just before the monitor processes this
  // session's expiry.
  await EventTicket.updateOne(
    { _id: session.ticketIds[0] },
    { $set: { status: "paid", paidAt: new Date() } },
  );

  await runCheckoutSessionMonitorTick();

  const refreshedSession = await CheckoutSession.findById(session.id);
  expect(refreshedSession.status).toBe("purchased");

  const ticket = await EventTicket.findById(session.ticketIds[0]);
  expect(ticket.status).toBe("paid");
});
