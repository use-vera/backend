/* The two gates that decide whether an order may happen at all: how old the
   buyer is, and how much this vendor is allowed to have sold. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_vendor_gates";
process.env.PAYSTACK_DEV_BYPASS = "false";
process.env.VENDOR_STARTER_LIMIT_NAIRA = "10000";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
}));

const vendorOrderService = require("../services/vendor-order.service");
const vendorService = require("../services/vendor.service");
const eventVendorService = require("../services/event-vendor.service");
const { verifyPaystackTransaction } = require("../services/paystack.service");
const User = require("../models/user.model");
const Vendor = require("../models/vendor.model");
const { ageFromDateOfBirth, isAdult } = require("../utils/age");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;
const yearsAgo = (years) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);

  return date;
};

const stall = async ({ ageRestricted = false, priceNaira = 4000 } = {}) => {
  const organizer = await createUser();
  const vendorOwner = await createUser();
  const buyer = await createUser();

  const event = await createEvent({
    organizerUserId: organizer._id,
    /* Under way: orders are only taken while an event is live. */
    startsAt: new Date(Date.now() - HOUR_MS),
    endsAt: new Date(Date.now() + 6 * HOUR_MS),
    vendorSettings: { acceptingApplications: true, stallFeeNaira: 0, spots: 0 },
  });

  const vendor = await vendorService.createVendor({
    actorUserId: vendorOwner._id,
    payload: { businessName: "Chilled Bar Co.", categories: ["drinks"] },
  });

  const invite = await eventVendorService.inviteVendor({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { vendorId: vendor._id },
  });
  await eventVendorService.respondToInvite({
    bookingId: invite._id,
    actorUserId: vendorOwner._id,
    accept: true,
  });

  const item = await vendorService.createItem({
    actorUserId: vendorOwner._id,
    payload: {
      name: ageRestricted ? "Cold beer" : "Chapman",
      category: "drinks",
      priceNaira,
      ageRestricted,
    },
  });

  await createPaidTicket({ event, buyerUserId: buyer._id });

  return { organizer, vendorOwner, vendor, buyer, event, item };
};

const order = (context, quantity = 1) =>
  vendorOrderService.placeOrder({
    eventId: context.event._id,
    vendorId: context.vendor._id,
    actorUserId: context.buyer._id,
    payload: { items: [{ itemId: context.item._id, quantity }] },
  });

describe("age", () => {
  test("the helper does not round a birthday up", () => {
    const almost = new Date();
    almost.setFullYear(almost.getFullYear() - 18);
    almost.setDate(almost.getDate() + 1);

    expect(isAdult(almost)).toBe(false);
    expect(ageFromDateOfBirth(almost)).toBe(17);
    expect(isAdult(yearsAgo(18))).toBe(true);
    // Unknown is never an adult.
    expect(isAdult(null)).toBe(false);
    expect(isAdult("not a date")).toBe(false);
  });

  test("an 18+ item cannot be bought without a date of birth on file", async () => {
    const context = await stall({ ageRestricted: true });

    await expect(order(context)).rejects.toMatchObject({
      statusCode: 403,
      code: "DATE_OF_BIRTH_REQUIRED",
    });
  });

  test("a minor is refused, an adult is served", async () => {
    const context = await stall({ ageRestricted: true });

    await User.updateOne(
      { _id: context.buyer._id },
      { $set: { dateOfBirth: yearsAgo(16) } },
    );

    await expect(order(context)).rejects.toMatchObject({
      statusCode: 403,
      code: "UNDERAGE",
    });

    await User.updateOne(
      { _id: context.buyer._id },
      { $set: { dateOfBirth: yearsAgo(25) } },
    );

    const placed = await order(context);
    expect(placed.order.status).toBe("pending_payment");
  });

  test("an ordinary item never asks anyone's age", async () => {
    const context = await stall({ ageRestricted: false });

    const placed = await order(context);
    expect(placed.order.status).toBe("pending_payment");
  });

  test("the buyer's menu says which items are 18+", async () => {
    const context = await stall({ ageRestricted: true });

    const menu = await vendorOrderService.getVendorMenuForBuyers({
      eventId: context.event._id,
      vendorId: context.vendor._id,
      actorUserId: context.buyer._id,
    });

    expect(menu.sections[0].items[0].ageRestricted).toBe(true);
  });
});

describe("sales limits", () => {
  const pay = async (placed, buyer) => {
    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: placed.order.pricing.totalChargedNaira * 100,
    });

    return vendorOrderService.verifyOrderPayment({
      orderId: placed.order._id,
      actorUserId: buyer._id,
      reference: placed.payment.reference,
    });
  };

  test("a starter vendor stops at their ceiling, and held money counts", async () => {
    const context = await stall({ priceNaira: 6000 });

    const first = await order(context);
    await pay(first, context.buyer);

    // ₦6,000 sold, ₦10,000 allowed: a second ₦6,000 order is over the line.
    await expect(order(context)).rejects.toMatchObject({
      statusCode: 409,
      code: "VENDOR_LIMIT_REACHED",
    });
  });

  test("being verified lifts the ceiling", async () => {
    const context = await stall({ priceNaira: 6000 });

    const first = await order(context);
    await pay(first, context.buyer);

    await Vendor.updateOne(
      { _id: context.vendor._id },
      { $set: { verificationLevel: "verified" } },
    );

    const second = await order(context);
    expect(second.order.status).toBe("pending_payment");
  });

  test("limits tell a vendor where they stand", async () => {
    const context = await stall({ priceNaira: 6000 });
    const placed = await order(context);
    await pay(placed, context.buyer);

    const limits = await vendorService.getMyLimits({
      actorUserId: context.vendorOwner._id,
    });

    expect(limits).toMatchObject({
      verificationLevel: "starter",
      soldNaira: 6000,
      limitNaira: 10000,
      remainingNaira: 4000,
    });
    expect(limits.next.level).toBe("verified");
  });
});

describe("verification", () => {
  test("a BVN needs a date of birth first, and only the last four are kept", async () => {
    const context = await stall();

    await expect(
      vendorService.submitVerification({
        actorUserId: context.vendorOwner._id,
        payload: { bvn: "12345678901" },
      }),
    ).rejects.toMatchObject({ code: "DATE_OF_BIRTH_REQUIRED" });

    await User.updateOne(
      { _id: context.vendorOwner._id },
      { $set: { dateOfBirth: yearsAgo(30) } },
    );

    const submitted = await vendorService.submitVerification({
      actorUserId: context.vendorOwner._id,
      payload: { bvn: "12345678901" },
    });

    expect(submitted.verification.status).toBe("pending");
    expect(submitted.verification.bvnLast4).toBe("8901");

    // The number itself is nowhere in the document.
    const stored = await Vendor.findById(context.vendor._id);
    expect(JSON.stringify(stored.toObject())).not.toContain("12345678901");
  });

  test("submitting does not verify anyone: a decision does", async () => {
    const context = await stall();

    await User.updateOne(
      { _id: context.vendorOwner._id },
      { $set: { dateOfBirth: yearsAgo(30) } },
    );
    await vendorService.submitVerification({
      actorUserId: context.vendorOwner._id,
      payload: { bvn: "12345678901" },
    });

    const pending = await Vendor.findById(context.vendor._id);
    expect(pending.verificationLevel).toBe("starter");

    const approved = await vendorService.reviewVendorVerification({
      vendorId: context.vendor._id,
      approve: true,
    });

    expect(approved.verificationLevel).toBe("verified");
    expect(approved.verification.status).toBe("verified");
  });

  test("a CAC number is what makes a registered business", async () => {
    const context = await stall();

    await vendorService.submitVerification({
      actorUserId: context.vendorOwner._id,
      payload: { cacNumber: "RC-123456" },
    });

    const approved = await vendorService.reviewVendorVerification({
      vendorId: context.vendor._id,
      approve: true,
    });

    expect(approved.verificationLevel).toBe("registered");
  });

  test("a rejection leaves the level where it was", async () => {
    const context = await stall();

    await vendorService.submitVerification({
      actorUserId: context.vendorOwner._id,
      payload: { cacNumber: "RC-123456" },
    });

    const rejected = await vendorService.reviewVendorVerification({
      vendorId: context.vendor._id,
      approve: false,
      note: "That number could not be found",
    });

    expect(rejected.verificationLevel).toBe("starter");
    expect(rejected.verification.status).toBe("rejected");
    expect(rejected.verification.reviewNote).toBe(
      "That number could not be found",
    );
  });

  test("suspending a vendor stops them selling, and it can be undone", async () => {
    const context = await stall();

    await vendorService.setVendorStatus({
      vendorId: context.vendor._id,
      status: "suspended",
    });

    await expect(order(context)).rejects.toMatchObject({ statusCode: 404 });

    await vendorService.setVendorStatus({
      vendorId: context.vendor._id,
      status: "active",
    });

    const placed = await order(context);
    expect(placed.order.status).toBe("pending_payment");
  });
});
