/* The invite conversation, both directions. Email is stubbed at the service
   boundary: what matters here is that the right person is written to, not how
   the message is rendered (vendor-invite-emails.test.js covers that). */
process.env.PAYSTACK_SECRET_KEY = "sk_test_stall_fees";
process.env.PAYSTACK_DEV_BYPASS = "false";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
}));

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  dispatchEmail: jest.fn().mockResolvedValue(null),
}));

const eventVendorService = require("../services/event-vendor.service");
const vendorService = require("../services/vendor.service");
const { dispatchEmail } = require("../services/email.service");
const EventVendor = require("../models/event-vendor.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const {
  verifyPaystackTransaction,
} = require("../services/paystack.service");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const upcomingEvent = (organizerUserId, vendorSettings = {}) =>
  createEvent({
    organizerUserId,
    name: "Afrobeats Night Lagos",
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 54 * HOUR_MS),
    vendorSettings: {
      acceptingApplications: true,
      stallFeeNaira: 0,
      spots: 0,
      ...vendorSettings,
    },
  });

const newVendor = async (overrides = {}) => {
  const owner = await createUser();
  const vendor = await vendorService.createVendor({
    actorUserId: owner._id,
    payload: {
      businessName: "Mama Put Express",
      categories: ["food"],
      ...overrides,
    },
  });

  return { owner, vendor };
};

const recipients = () =>
  dispatchEmail.mock.calls.map((call) => call[0].to);

beforeEach(() => {
  dispatchEmail.mockClear();
});

describe("organizer invites a vendor", () => {
  test("the vendor is emailed, and the event's terms are copied onto the booking", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id, terms: { stallLabel: "Stall 7" } },
    });

    expect(booking.status).toBe("invited");
    expect(booking.terms.stallFeeNaira).toBe(0);
    expect(booking.terms.stallLabel).toBe("Stall 7");

    expect(dispatchEmail).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([owner.email]);
    expect(dispatchEmail.mock.calls[0][0].subject).toContain(
      "You're invited to sell at Afrobeats Night Lagos",
    );
  });

  test("terms already agreed do not move when the event's defaults change", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { vendor } = await newVendor();

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    await eventVendorService.updateVendorSettings({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { stallFeeNaira: 90000 },
    });

    const stored = await EventVendor.findById(booking._id);
    expect(stored.terms.stallFeeNaira).toBe(0);
  });

  test("someone who does not run the event cannot invite to it", async () => {
    const organizer = await createUser();
    const stranger = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { vendor } = await newVendor();

    await expect(
      eventVendorService.inviteVendor({
        eventId: event._id,
        actorUserId: stranger._id,
        payload: { vendorId: vendor._id },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  test("the same vendor cannot hold two open invitations", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { vendor } = await newVendor();

    await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    await expect(
      eventVendorService.inviteVendor({
        eventId: event._id,
        actorUserId: organizer._id,
        payload: { vendorId: vendor._id },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("a vendor who declined can be invited again, on the same row", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const first = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    await eventVendorService.respondToInvite({
      bookingId: first._id,
      actorUserId: owner._id,
      accept: false,
      note: "Already booked",
    });

    const second = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    expect(second._id).toBe(first._id);
    expect(second.status).toBe("invited");
    expect(await EventVendor.countDocuments({ eventId: event._id })).toBe(1);
  });
});

describe("vendor answers", () => {
  test("accepting confirms the stall and emails the organizer", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    dispatchEmail.mockClear();

    const answered = (
      await eventVendorService.respondToInvite({
        bookingId: booking._id,
        actorUserId: owner._id,
        accept: true,
      })
    ).booking;

    expect(answered.status).toBe("confirmed");
    // This event charges no stall fee, so there is nothing left to pay.
    expect(answered.stallFeePaid).toBe(true);
    expect(recipients()).toEqual([organizer.email]);
    expect(dispatchEmail.mock.calls[0][0].subject).toContain("accepted");
  });

  test("declining says so, with the reason, and frees the spot", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    dispatchEmail.mockClear();

    const answered = (
      await eventVendorService.respondToInvite({
        bookingId: booking._id,
        actorUserId: owner._id,
        accept: false,
        note: "Already booked that day",
      })
    ).booking;

    expect(answered.status).toBe("declined");
    expect(answered.responseNote).toBe("Already booked that day");
    expect(dispatchEmail.mock.calls[0][0].html).toContain(
      "Already booked that day",
    );
  });

  test("one vendor cannot answer another vendor's invitation", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { vendor } = await newVendor();
    const other = await newVendor({ businessName: "Suya Spot" });

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    await expect(
      eventVendorService.respondToInvite({
        bookingId: booking._id,
        actorUserId: other.owner._id,
        accept: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("an invitation can only be answered once", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    await eventVendorService.respondToInvite({
      bookingId: booking._id,
      actorUserId: owner._id,
      accept: true,
    });

    await expect(
      eventVendorService.respondToInvite({
        bookingId: booking._id,
        actorUserId: owner._id,
        accept: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("vendor applies", () => {
  test("the organizer is emailed, and accepting sends the vendor the terms to confirm", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner, vendor } = await newVendor();

    const applied = await eventVendorService.applyToEvent({
      eventId: event._id,
      actorUserId: owner._id,
      message: "We sell jollof",
    });

    expect(applied.status).toBe("applied");
    expect(recipients()).toEqual([organizer.email]);
    dispatchEmail.mockClear();

    const decided = await eventVendorService.decideApplication({
      eventId: event._id,
      bookingId: applied._id,
      actorUserId: organizer._id,
      accept: true,
      terms: { stallLabel: "Stall 3" },
    });

    /* Accepted, but not confirmed: the vendor still has to agree to the
       terms, which is the same invitation flow as any other. */
    expect(decided.status).toBe("invited");
    expect(decided.terms.stallLabel).toBe("Stall 3");
    expect(recipients()).toEqual([owner.email]);

    const confirmed = (
      await eventVendorService.respondToInvite({
        bookingId: decided._id,
        actorUserId: owner._id,
        accept: true,
      })
    ).booking;
    expect(confirmed.status).toBe("confirmed");
    expect(vendor.businessName).toBe("Mama Put Express");
  });

  test("an event that is not taking applications refuses them", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, {
      acceptingApplications: false,
    });
    const { owner } = await newVendor();

    await expect(
      eventVendorService.applyToEvent({
        eventId: event._id,
        actorUserId: owner._id,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("a rejection is final for that round, and emails the vendor", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id);
    const { owner } = await newVendor();

    const applied = await eventVendorService.applyToEvent({
      eventId: event._id,
      actorUserId: owner._id,
    });
    dispatchEmail.mockClear();

    const decided = await eventVendorService.decideApplication({
      eventId: event._id,
      bookingId: applied._id,
      actorUserId: organizer._id,
      accept: false,
    });

    expect(decided.status).toBe("rejected");
    expect(recipients()).toEqual([owner.email]);

    await expect(
      eventVendorService.decideApplication({
        eventId: event._id,
        bookingId: applied._id,
        actorUserId: organizer._id,
        accept: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("spots and listings", () => {
  test("an event with one spot stops at one confirmed vendor", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { spots: 1 });
    const first = await newVendor();
    const second = await newVendor({ businessName: "Suya Spot" });

    const booking = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: first.vendor._id },
    });
    await eventVendorService.respondToInvite({
      bookingId: booking._id,
      actorUserId: first.owner._id,
      accept: true,
    });

    await expect(
      eventVendorService.inviteVendor({
        eventId: event._id,
        actorUserId: organizer._id,
        payload: { vendorId: second.vendor._id },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("the organizer's tab counts each kind, and only they can read it", async () => {
    const organizer = await createUser();
    const stranger = await createUser();
    const event = await upcomingEvent(organizer._id);
    const invited = await newVendor();
    const applicant = await newVendor({ businessName: "Suya Spot" });

    await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: invited.vendor._id },
    });
    await eventVendorService.applyToEvent({
      eventId: event._id,
      actorUserId: applicant.owner._id,
    });

    const tab = await eventVendorService.listEventVendors({
      eventId: event._id,
      actorUserId: organizer._id,
    });

    expect(tab.counts).toEqual({ confirmed: 0, invited: 1, applied: 1 });
    expect(tab.items[0].vendor.businessName).toBeTruthy();

    await expect(
      eventVendorService.listEventVendors({
        eventId: event._id,
        actorUserId: stranger._id,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("open events exclude the ones this vendor already answered", async () => {
    const organizer = await createUser();
    const open = await upcomingEvent(organizer._id);
    await upcomingEvent(organizer._id, { acceptingApplications: false });
    const { owner } = await newVendor();

    const before = await eventVendorService.listOpenEvents({
      actorUserId: owner._id,
    });
    expect(before.items).toHaveLength(1);

    await eventVendorService.applyToEvent({
      eventId: open._id,
      actorUserId: owner._id,
    });

    const after = await eventVendorService.listOpenEvents({
      actorUserId: owner._id,
    });
    expect(after.items).toHaveLength(0);
  });
});

describe("stall fees", () => {
  test("accepting a stall with a fee asks for payment and does not confirm yet", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    const answered = await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    expect(answered.requiresPayment).toBe(true);
    expect(answered.payment.authorizationUrl).toBeTruthy();

    /* Still invited: an abandoned checkout must not hold a spot the
       organizer could have given to someone else. */
    const stored = await EventVendor.findById(invite._id);
    expect(stored.status).toBe("invited");
    expect(stored.stallFeePaid).toBe(false);
  });

  test("paying the fee confirms the stall and credits the organizer", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    const answered = await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: 25000 * 100,
    });

    const confirmed = await eventVendorService.verifyStallFee({
      bookingId: invite._id,
      actorUserId: owner._id,
      reference: answered.payment.reference,
    });

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.stallFeePaid).toBe(true);

    const credit = await WalletTransaction.findOne({
      organizerUserId: organizer._id,
      type: "vendor_stall_fee",
    });
    expect(credit.amountKobo).toBe(25000 * 100);
  });

  test("a short payment does not buy a stall", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    const answered = await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: 500 * 100,
    });

    await expect(
      eventVendorService.verifyStallFee({
        bookingId: invite._id,
        actorUserId: owner._id,
        reference: answered.payment.reference,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const stored = await EventVendor.findById(invite._id);
    expect(stored.status).toBe("invited");
  });

  test("declining a stall with a fee charges nothing", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });

    const answered = await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: false,
    });

    expect(answered.requiresPayment).toBe(false);
    expect(answered.booking.status).toBe("declined");
  });
});

describe("the payment window", () => {
  const acceptWithFee = async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    const answered = await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    return { organizer, event, owner, vendor, invite, answered };
  };

  test("accepting a stall with a fee starts a four hour clock", async () => {
    const { invite, answered } = await acceptWithFee();

    expect(answered.requiresPayment).toBe(true);

    const stored = await EventVendor.findById(invite._id);
    const hours =
      (stored.stallFeeDueAt.getTime() - Date.now()) / (60 * 60 * 1000);

    expect(hours).toBeGreaterThan(3.9);
    expect(hours).toBeLessThanOrEqual(4);
  });

  test("reopening checkout does not buy more time", async () => {
    const { invite, owner } = await acceptWithFee();
    const first = await EventVendor.findById(invite._id);

    await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    const second = await EventVendor.findById(invite._id);
    expect(second.stallFeeDueAt.getTime()).toBe(first.stallFeeDueAt.getTime());
  });

  test("paying clears the deadline", async () => {
    const { invite, owner, answered } = await acceptWithFee();

    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: 25000 * 100,
    });

    await eventVendorService.verifyStallFee({
      bookingId: invite._id,
      actorUserId: owner._id,
      reference: answered.payment.reference,
    });

    const stored = await EventVendor.findById(invite._id);
    expect(stored.stallFeePaid).toBe(true);
    expect(stored.stallFeeDueAt).toBeNull();
  });

  test("a lapsed window cannot be paid, and the spot is released", async () => {
    const { invite, owner, answered } = await acceptWithFee();

    await EventVendor.updateOne(
      { _id: invite._id },
      { $set: { stallFeeDueAt: new Date(Date.now() - 60 * 1000) } },
    );

    await expect(
      eventVendorService.verifyStallFee({
        bookingId: invite._id,
        actorUserId: owner._id,
        reference: answered.payment.reference,
      }),
    ).rejects.toMatchObject({ code: "STALL_HOLD_EXPIRED" });

    const stored = await EventVendor.findById(invite._id);
    expect(stored.status).toBe("cancelled");
    expect(stored.responseNote).toBe("Stall fee was not paid in time");
  });

  test("a lapsed hold stops blocking the last spot", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, {
      stallFeeNaira: 25000,
      spots: 1,
    });
    const first = await newVendor();
    const second = await newVendor({ businessName: "Suya Spot" });

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: first.vendor._id },
    });
    await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: first.owner._id,
      accept: true,
    });

    await EventVendor.updateOne(
      { _id: invite._id },
      { $set: { stallFeeDueAt: new Date(Date.now() - 60 * 1000) } },
    );

    /* The unpaid hold has lapsed, so the spot is somebody else's to take. */
    const reinvite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: second.vendor._id },
    });

    expect(reinvite.status).toBe("invited");
  });

  test("an accepted application starts the clock from the organizer's yes", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 25000 });
    const { owner } = await newVendor();

    const applied = await eventVendorService.applyToEvent({
      eventId: event._id,
      actorUserId: owner._id,
    });

    const decided = await eventVendorService.decideApplication({
      eventId: event._id,
      bookingId: applied._id,
      actorUserId: organizer._id,
      accept: true,
    });

    expect(decided.stallFeeDueAt).toBeTruthy();

    const hours =
      (new Date(decided.stallFeeDueAt).getTime() - Date.now()) /
      (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(3.9);
  });

  test("a free stall gets no deadline at all", async () => {
    const organizer = await createUser();
    const event = await upcomingEvent(organizer._id, { stallFeeNaira: 0 });
    const { owner, vendor } = await newVendor();

    const invite = await eventVendorService.inviteVendor({
      eventId: event._id,
      actorUserId: organizer._id,
      payload: { vendorId: vendor._id },
    });
    await eventVendorService.respondToInvite({
      bookingId: invite._id,
      actorUserId: owner._id,
      accept: true,
    });

    const stored = await EventVendor.findById(invite._id);
    expect(stored.status).toBe("confirmed");
    expect(stored.stallFeeDueAt).toBeNull();
  });
});
