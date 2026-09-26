/* Proves the callback URL a client sends reaches Paystack, which is the whole
   difference between the popup coming back and stopping on Paystack's page. */
process.env.PAYSTACK_SECRET_KEY = "sk_test_cb";
process.env.PAYSTACK_DEV_BYPASS = "false";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "code",
    reference: "ref",
  }),
  verifyPaystackTransaction: jest.fn(),
}));
jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  dispatchEmail: jest.fn().mockResolvedValue(null),
}));

const eventVendorService = require("../services/event-vendor.service");
const vendorService = require("../services/vendor.service");
const {
  initializePaystackTransaction,
} = require("../services/paystack.service");
const { createUser, createEvent } = require("./fixtures");

test("the stall fee checkout is told where to come back to", async () => {
  const organizer = await createUser();
  const owner = await createUser();
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 48 * 3600 * 1000),
    endsAt: new Date(Date.now() + 54 * 3600 * 1000),
    vendorSettings: { acceptingApplications: true, stallFeeNaira: 25000, spots: 0 },
  });
  const vendor = await vendorService.createVendor({
    actorUserId: owner._id,
    payload: { businessName: "Qless Express", categories: ["food"] },
  });

  const invite = await eventVendorService.inviteVendor({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { vendorId: vendor._id },
  });

  await eventVendorService.respondToInvite({
    bookingId: invite._id,
    actorUserId: owner._id,
    accept: true,
    callbackUrl: "https://vera.test/checkout/callback",
  });

  expect(initializePaystackTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ callbackUrl: "https://vera.test/checkout/callback" }),
  );
});
