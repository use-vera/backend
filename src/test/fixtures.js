const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Workspace = require("../models/workspace.model");
const Membership = require("../models/membership.model");
const ApiKey = require("../models/api-key.model");
const { computePrimaryTicketPricing } = require("../services/pricing.service");
const { generateApiKeyPair } = require("../utils/api-key");
const { ALL_SCOPES } = require("../config/api-scopes");

let counter = 0;
const uniqueId = () => {
  counter += 1;
  return `${Date.now()}_${counter}`;
};

const createUser = async (overrides = {}) =>
  User.create({
    fullName: "Test Organizer",
    email: `organizer_${uniqueId()}@example.com`,
    passwordHash: "not-a-real-hash",
    ...overrides,
  });

const createEvent = async ({ organizerUserId, endsAt, ...overrides }) =>
  Event.create({
    organizerUserId,
    name: "Test Event",
    address: "12 Test Street, Lagos",
    latitude: 6.5244,
    longitude: 3.3792,
    startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endsAt: endsAt || new Date(Date.now() - 60 * 60 * 1000),
    isPaid: true,
    ticketPriceNaira: 10000,
    expectedTickets: 100,
    status: "published",
    ...overrides,
  });

/**
 * Builds a ticket with a real pricingBreakdown (via the real pricing
 * service, not a hand-rolled fake) so wallet.service.js's assumptions about
 * ticket.paymentMetadata.pricingBreakdown match production exactly.
 */
const createPaidTicket = async ({
  event,
  buyerUserId,
  baseUnitPriceNaira = 10000,
  platformFeePercent = 5,
  feeMode = "absorbed_by_organizer",
  ...overrides
}) => {
  const pricingBreakdown = computePrimaryTicketPricing({
    baseUnitPriceNaira,
    quantity: 1,
    platformFeePercent,
    feeMode,
  });

  return EventTicket.create({
    eventId: event._id,
    organizerUserId: event.organizerUserId,
    workspaceId: event.workspaceId,
    buyerUserId,
    quantity: 1,
    unitPriceNaira: pricingBreakdown.unitCheckoutPriceNaira,
    totalPriceNaira: pricingBreakdown.totalCheckoutNaira,
    status: "paid",
    paymentProvider: "paystack",
    paymentReference: `test_ref_${uniqueId()}`,
    paymentMetadata: {
      pricingBreakdown: {
        basePriceNaira: pricingBreakdown.basePriceNaira,
        veraFeeNaira: pricingBreakdown.veraFeeNaira,
        totalCheckoutNaira: pricingBreakdown.totalCheckoutNaira,
        organizerNetNaira: pricingBreakdown.organizerNetNaira,
        platformFeePercent: pricingBreakdown.platformFeePercent,
        feeMode: pricingBreakdown.feeMode,
      },
    },
    attendeeName: "Test Attendee",
    attendeeEmail: "attendee@example.com",
    ticketCode: `VRA-${uniqueId()}`,
    barcodeValue: `barcode_${uniqueId()}`,
    paidAt: new Date(),
    verifiedAt: new Date(),
    ...overrides,
  });
};

const createWorkspace = async ({ ownerUserId, ...overrides }) => {
  const workspace = await Workspace.create({
    name: "Test Workspace",
    slug: `test-workspace-${uniqueId()}`,
    ownerUserId,
    ...overrides,
  });

  await Membership.create({
    workspaceId: workspace._id,
    userId: ownerUserId,
    role: "owner",
    status: "active",
  });

  return workspace;
};

const createApiKey = async ({
  workspaceId,
  createdByUserId,
  mode = "live",
  scopes = ALL_SCOPES,
  ...overrides
}) => {
  const { publishableKey, secretKey, secretKeyHash, secretKeyLastFour } =
    generateApiKeyPair(mode);

  const apiKey = await ApiKey.create({
    workspaceId,
    mode,
    label: "Test key",
    publishableKey,
    secretKeyHash,
    secretKeyLastFour,
    scopes,
    createdByUserId,
    ...overrides,
  });

  return { apiKey, rawSecret: secretKey, publishableKey };
};

module.exports = {
  createUser,
  createEvent,
  createPaidTicket,
  createWorkspace,
  createApiKey,
};
