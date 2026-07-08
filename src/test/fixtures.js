const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { computePrimaryTicketPricing } = require("../services/pricing.service");

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
  });
};

module.exports = { createUser, createEvent, createPaidTicket };
