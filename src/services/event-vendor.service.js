const Event = require("../models/event.model");
const EventVendor = require("../models/event-vendor.model");
const Vendor = require("../models/vendor.model");
const User = require("../models/user.model");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditStallFee } = require("./wallet.service");
const {
  canUserManageEvent,
  createPaymentAttemptForCheckout,
} = require("./event.service");
const { verifyPaystackTransaction } = require("./paystack.service");
const { dispatchEmail } = require("./email.service");
const vendorEmails = require("../emails/vendor-invite.emails");

/**
 * Vendors at events: invitations, applications, and the answers to both.
 *
 * Two doors into the same row. An organizer invites a vendor, or a vendor
 * applies to an event; whoever did not open it is the one who answers.
 */

const OPEN_STATUSES = ["invited", "applied", "confirmed"];

const HOUR_MS = 60 * 60 * 1000;

/** When a fee becomes payable, the clock starts. */
const stallFeeDeadline = () =>
  new Date(Date.now() + env.stallFeeHoldHours * HOUR_MS);

/**
 * Gives back every spot whose payment window has run out.
 *
 * Called before anything that depends on how many spots are taken, so a
 * lapsed hold never blocks a vendor who would actually pay. The monitor runs
 * it on a timer too, so a spot frees up even when nobody is looking.
 */
const releaseLapsedStallHolds = async (filter = {}) => {
  const result = await EventVendor.updateMany(
    {
      ...filter,
      status: "invited",
      stallFeePaid: false,
      stallFeeDueAt: { $ne: null, $lte: new Date() },
    },
    {
      $set: {
        status: "cancelled",
        respondedAt: new Date(),
        responseNote: "Stall fee was not paid in time",
        stallFeeDueAt: null,
      },
    },
  );

  return result.modifiedCount || 0;
};

const toIdString = (value) => String(value?._id || value || "");

const formatEventDate = (date) => {
  if (!date) {
    return "";
  }

  return new Date(date).toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
};

const mapBooking = (row, { event, vendor } = {}) => ({
  _id: toIdString(row),
  eventId: toIdString(row.eventId),
  vendorId: toIdString(row.vendorId),
  status: row.status,
  origin: row.origin,
  terms: {
    stallFeeNaira: row.terms?.stallFeeNaira || 0,
    stallLabel: row.terms?.stallLabel || "",
    setupFrom: row.terms?.setupFrom || null,
  },
  message: row.message || "",
  responseNote: row.responseNote || "",
  respondedAt: row.respondedAt || null,
  stallFeePaid: Boolean(row.stallFeePaid),
  stallFeeDueAt: row.stallFeeDueAt || null,
  /* Event-night state, so the vendor's orders screen can render its switch
     and wait time from the same payload. */
  acceptingOrders: row.acceptingOrders !== false,
  prepMinutes: row.prepMinutes ?? null,
  createdAt: row.createdAt,
  ...(event
    ? {
        event: {
          _id: toIdString(event),
          name: event.name,
          startsAt: event.startsAt,
          address: event.address,
          imageUrl: event.imageUrl || "",
        },
      }
    : {}),
  ...(vendor
    ? {
        vendor: {
          _id: toIdString(vendor),
          businessName: vendor.businessName,
          slug: vendor.slug,
          logoUrl: vendor.logoUrl || "",
          categories: vendor.categories || [],
          averageRating: vendor.averageRating || 0,
          ratingsCount: vendor.ratingsCount || 0,
          eventsWorkedCount: vendor.eventsWorkedCount || 0,
        },
      }
    : {}),
});

const requireEvent = async (eventId) => {
  const event = await Event.findById(eventId);

  if (!event || event.status === "cancelled") {
    throw new ApiError(404, "Event not found");
  }

  return event;
};

/** The organizer side of the door. */
const requireManageableEvent = async (eventId, actorUserId) => {
  const event = await requireEvent(eventId);

  if (!(await canUserManageEvent(event, actorUserId))) {
    throw new ApiError(403, "You cannot manage vendors for this event");
  }

  return event;
};

/** The vendor side. */
const requireOwnVendor = async (actorUserId) => {
  const vendor = await Vendor.findOne({ ownerUserId: actorUserId });

  if (!vendor) {
    throw new ApiError(
      404,
      "You do not have a vendor account yet",
      null,
      "VENDOR_NOT_FOUND",
    );
  }

  if (vendor.status === "suspended") {
    throw new ApiError(403, "This vendor account is suspended");
  }

  return vendor;
};

const countConfirmed = (eventId) =>
  EventVendor.countDocuments({ eventId, status: "confirmed" });

/** Refuses a booking that would take an event past the room it has. */
const assertSpotAvailable = async (event) => {
  const spots = Number(event.vendorSettings?.spots || 0);

  if (spots <= 0) {
    return;
  }

  await releaseLapsedStallHolds({ eventId: event._id });

  if ((await countConfirmed(event._id)) >= spots) {
    throw new ApiError(409, "This event has no vendor spots left");
  }
};

const termsFromEvent = (event, overrides = {}) => ({
  stallFeeNaira:
    overrides.stallFeeNaira ?? Number(event.vendorSettings?.stallFeeNaira || 0),
  stallLabel: overrides.stallLabel ?? "",
  setupFrom: overrides.setupFrom ?? event.vendorSettings?.setupFrom ?? null,
});

/* ------------------------------------------------------------------ emails */

/**
 * Mail is sent after the write has already landed, and never allowed to fail
 * it: a confirmed stall that could not be emailed is still a confirmed stall.
 */
const emailVendorInvited = async ({
  event,
  vendor,
  organizerName,
  booking,
}) => {
  const owner = await User.findById(vendor.ownerUserId).select("email");

  if (!owner?.email) {
    return;
  }

  const mail = vendorEmails.vendorInvited({
    event: {
      name: event.name,
      startsAtLabel: formatEventDate(event.startsAt),
      venue: event.address,
      ticketsSold: 0,
    },
    vendor: { businessName: vendor.businessName },
    organizer: { name: organizerName },
    terms: booking.terms,
    inviteId: toIdString(booking),
  });

  await dispatchEmail({ to: owner.email, ...mail });
};

const emailOrganizer = async ({ event, mail }) => {
  const organizer = await User.findById(event.organizerUserId).select("email");

  if (!organizer?.email) {
    return;
  }

  await dispatchEmail({ to: organizer.email, ...mail });
};

const emailVendorOwner = async ({ vendor, mail }) => {
  const owner = await User.findById(vendor.ownerUserId).select("email");

  if (!owner?.email) {
    return;
  }

  await dispatchEmail({ to: owner.email, ...mail });
};

/* -------------------------------------------------------- organizer writes */

const updateVendorSettings = async ({ eventId, actorUserId, payload }) => {
  const event = await requireManageableEvent(eventId, actorUserId);
  const current = event.vendorSettings || {};

  event.vendorSettings = {
    acceptingApplications:
      payload.acceptingApplications ?? current.acceptingApplications ?? false,
    stallFeeNaira: payload.stallFeeNaira ?? current.stallFeeNaira ?? 0,
    spots: payload.spots ?? current.spots ?? 0,
    setupFrom: payload.setupFrom ?? current.setupFrom ?? null,
  };

  await event.save();

  return { vendorSettings: event.vendorSettings };
};

const inviteVendor = async ({ eventId, actorUserId, payload }) => {
  const event = await requireManageableEvent(eventId, actorUserId);
  const vendor = await Vendor.findOne({
    _id: payload.vendorId,
    status: "active",
  });

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  const existing = await EventVendor.findOne({
    eventId: event._id,
    vendorId: vendor._id,
  });

  if (existing && OPEN_STATUSES.includes(existing.status)) {
    throw new ApiError(
      409,
      existing.status === "confirmed"
        ? "That vendor is already confirmed for this event"
        : "That vendor already has an open invitation",
    );
  }

  await assertSpotAvailable(event);

  const terms = termsFromEvent(event, payload.terms || {});
  const fields = {
    status: "invited",
    origin: "invite",
    terms,
    invitedByUserId: actorUserId,
    message: String(payload.message || "").trim(),
    responseNote: "",
    respondedAt: null,
  };

  /* A vendor who declined before can be asked again: the same row is reused
     rather than piling up one per attempt. */
  const booking = existing
    ? Object.assign(existing, fields)
    : new EventVendor({ eventId: event._id, vendorId: vendor._id, ...fields });

  await booking.save();

  const organizer = await User.findById(event.organizerUserId).select(
    "fullName",
  );
  await emailVendorInvited({
    event,
    vendor,
    organizerName: organizer?.fullName || "An organizer",
    booking,
  });

  return mapBooking(booking, { vendor });
};

const decideApplication = async ({
  eventId,
  bookingId,
  actorUserId,
  accept,
  terms,
}) => {
  const event = await requireManageableEvent(eventId, actorUserId);
  const booking = await EventVendor.findOne({
    _id: bookingId,
    eventId: event._id,
  });

  if (!booking) {
    throw new ApiError(404, "Application not found");
  }

  if (booking.status !== "applied") {
    throw new ApiError(409, "That application has already been answered");
  }

  const vendor = await Vendor.findById(booking.vendorId);

  if (accept) {
    await assertSpotAvailable(event);
    /* Accepting an application is the organizer's offer, so the terms are
       fixed here and the vendor sees them before anything is charged. */
    booking.terms = termsFromEvent(event, terms || {});
    booking.status = "invited";
    booking.origin = "invite";

    /* The spot is theirs to take, not to sit on: the clock starts when the
       organizer accepts, whether or not the vendor has opened it yet. */
    booking.stallFeeDueAt =
      Number(booking.terms.stallFeeNaira || 0) > 0 ? stallFeeDeadline() : null;
  } else {
    booking.status = "rejected";
  }

  booking.respondedAt = new Date();
  await booking.save();

  const organizer = await User.findById(event.organizerUserId).select(
    "fullName",
  );

  await emailVendorOwner({
    vendor,
    mail: vendorEmails.vendorApplicationDecided({
      event: {
        name: event.name,
        startsAtLabel: formatEventDate(event.startsAt),
        venue: event.address,
      },
      organizer: { name: organizer?.fullName || "The organizer" },
      accepted: Boolean(accept),
      terms: booking.terms,
      inviteId: toIdString(booking),
    }),
  });

  return mapBooking(booking, { vendor });
};

const removeVendorFromEvent = async ({ eventId, bookingId, actorUserId }) => {
  const event = await requireManageableEvent(eventId, actorUserId);
  const booking = await EventVendor.findOne({
    _id: bookingId,
    eventId: event._id,
  });

  if (!booking) {
    throw new ApiError(404, "Vendor booking not found");
  }

  booking.status = "cancelled";
  booking.respondedAt = new Date();
  await booking.save();

  return mapBooking(booking);
};

/* ----------------------------------------------------------- vendor writes */

const applyToEvent = async ({ eventId, actorUserId, message }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const event = await requireEvent(eventId);

  if (!event.vendorSettings?.acceptingApplications) {
    throw new ApiError(409, "This event is not taking vendor applications");
  }

  const existing = await EventVendor.findOne({
    eventId: event._id,
    vendorId: vendor._id,
  });

  if (existing && OPEN_STATUSES.includes(existing.status)) {
    throw new ApiError(409, "You already have an open request for this event");
  }

  await assertSpotAvailable(event);

  const fields = {
    status: "applied",
    origin: "application",
    terms: termsFromEvent(event),
    message: String(message || "").trim(),
    responseNote: "",
    respondedAt: null,
  };

  const booking = existing
    ? Object.assign(existing, fields)
    : new EventVendor({ eventId: event._id, vendorId: vendor._id, ...fields });

  await booking.save();

  await emailOrganizer({
    event,
    mail: vendorEmails.vendorApplied({
      event: { name: event.name },
      vendor: {
        businessName: vendor.businessName,
        categoriesLabel: (vendor.categories || []).join(", "),
        ratingLabel: vendor.ratingsCount
          ? String(vendor.averageRating)
          : "New on Vera",
        eventsWorkedLabel: String(vendor.eventsWorkedCount || 0),
      },
      eventId: toIdString(event),
    }),
  });

  return mapBooking(booking, { event });
};

const respondToInvite = async ({ bookingId, actorUserId, accept, note, callbackUrl }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const booking = await EventVendor.findOne({
    _id: bookingId,
    vendorId: vendor._id,
  });

  if (!booking) {
    throw new ApiError(404, "Invitation not found");
  }

  if (booking.status !== "invited") {
    throw new ApiError(409, "That invitation has already been answered");
  }

  const event = await requireEvent(booking.eventId);

  if (accept) {
    await assertSpotAvailable(event);
  }

  const stallFeeNaira = Number(booking.terms?.stallFeeNaira || 0);
  const mustPay = Boolean(accept) && stallFeeNaira > 0;
  const shouldBypassPaystack =
    mustPay && !env.paystackSecretKey && env.paystackDevBypass;

  if (mustPay && !env.paystackSecretKey && !shouldBypassPaystack) {
    throw new ApiError(
      503,
      "Paid checkout is not configured yet. Set PAYSTACK_SECRET_KEY.",
    );
  }

  /**
   * A stall with a fee is not confirmed until the fee is paid.
   *
   * Leaving it `invited` while the payment is in flight is what stops an
   * abandoned checkout from holding a spot the organizer could have sold to
   * somebody else.
   */
  if (mustPay && !shouldBypassPaystack) {
    const owner = await User.findById(vendor.ownerUserId).select("email");

    const paymentAttempt = await createPaymentAttemptForCheckout({
      kind: "vendor_stall_fee",
      buyerUserId: actorUserId,
      eventId: event._id,
      amountKobo: Math.round(stallFeeNaira * 100),
      callbackUrl: String(callbackUrl || env.paystackCallbackUrl || ""),
      email: owner?.email,
      referenceSuffix: String(booking._id),
      metadata: {
        bookingId: String(booking._id),
        vendorId: String(vendor._id),
        eventId: String(event._id),
      },
    });

    booking.stallFeePaymentReference = paymentAttempt.reference;
    /* Only set once: a vendor reopening checkout does not buy themselves
       another four hours. */
    booking.stallFeeDueAt = booking.stallFeeDueAt || stallFeeDeadline();
    await booking.save();

    return {
      requiresPayment: true,
      booking: mapBooking(booking, { event }),
      payment: {
        reference: paymentAttempt.reference,
        authorizationUrl: paymentAttempt.authorizationUrl,
        accessCode: paymentAttempt.accessCode,
      },
    };
  }

  booking.status = accept ? "confirmed" : "declined";
  booking.responseNote = String(note || "").trim();
  booking.respondedAt = new Date();

  if (accept && stallFeeNaira === 0) {
    /* Nothing to pay, so nothing to wait for. */
    booking.stallFeePaid = true;
  }

  await booking.save();

  await emailOrganizer({
    event,
    mail: vendorEmails.vendorRespondedToInvite({
      event: {
        name: event.name,
        startsAtLabel: formatEventDate(event.startsAt),
        venue: event.address,
      },
      vendor: { businessName: vendor.businessName },
      accepted: Boolean(accept),
      declineReason: booking.responseNote,
      eventId: toIdString(event),
    }),
  });

  return { requiresPayment: false, booking: mapBooking(booking, { event }), payment: null };
};

/**
 * Confirms a paid stall fee, and only then the stall.
 *
 * Verified against Paystack rather than the client, like every other payment
 * in this codebase.
 */
const verifyStallFee = async ({ bookingId, actorUserId, reference }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const booking = await EventVendor.findOne({
    _id: bookingId,
    vendorId: vendor._id,
  });

  if (!booking) {
    throw new ApiError(404, "Invitation not found");
  }

  if (booking.status === "confirmed" && booking.stallFeePaid) {
    return mapBooking(booking);
  }

  if (booking.status !== "invited") {
    throw new ApiError(409, "That invitation is no longer open");
  }

  if (
    booking.stallFeeDueAt &&
    booking.stallFeeDueAt.getTime() < Date.now()
  ) {
    await releaseLapsedStallHolds({ _id: booking._id });

    throw new ApiError(
      409,
      "The payment window for this spot has closed",
      null,
      "STALL_HOLD_EXPIRED",
    );
  }

  const paymentReference = String(
    reference || booking.stallFeePaymentReference || "",
  ).trim();

  if (!paymentReference) {
    throw new ApiError(400, "This stall has no payment to verify");
  }

  const paymentData = await verifyPaystackTransaction(paymentReference);

  if (String(paymentData?.status) !== "success") {
    throw new ApiError(409, "That payment has not completed");
  }

  const expectedKobo = Math.round(
    Number(booking.terms?.stallFeeNaira || 0) * 100,
  );

  if (Number(paymentData?.amount || 0) < expectedKobo) {
    throw new ApiError(409, "Paid amount is below the stall fee", {
      expectedKobo,
    });
  }

  const event = await requireEvent(booking.eventId);
  await assertSpotAvailable(event);

  /* Read the row again inside the transaction rather than saving the copy
     loaded above: a retried transaction would re-run this body with a
     document Mongoose already considers saved, so its save() would write
     nothing and the vendor would come back paid but still unconfirmed. */
  const confirmed = await withMongoTransaction(async (session) => {
    const fresh = await EventVendor.findById(booking._id).session(session);

    fresh.status = "confirmed";
    fresh.stallFeePaid = true;
    fresh.stallFeePaymentReference = paymentReference;
    fresh.stallFeeDueAt = null;
    fresh.respondedAt = new Date();
    await fresh.save({ session });

    if (env.walletCreditingEnabled) {
      await creditStallFee({ booking: fresh, event, session });
    }

    return fresh;
  });

  await emailOrganizer({
    event,
    mail: vendorEmails.vendorRespondedToInvite({
      event: {
        name: event.name,
        startsAtLabel: formatEventDate(event.startsAt),
        venue: event.address,
      },
      vendor: { businessName: vendor.businessName },
      accepted: true,
      eventId: toIdString(event),
    }),
  });

  return mapBooking(confirmed, { event });
};

/* ------------------------------------------------------------------- reads */

const listEventVendors = async ({ eventId, actorUserId }) => {
  const event = await requireManageableEvent(eventId, actorUserId);

  await releaseLapsedStallHolds({ eventId: event._id });
  const rows = await EventVendor.find({ eventId: event._id })
    .populate("vendorId")
    .sort({ createdAt: -1 });

  const items = rows.map((row) => mapBooking(row, { vendor: row.vendorId }));

  return {
    vendorSettings: event.vendorSettings,
    items,
    counts: {
      confirmed: items.filter((item) => item.status === "confirmed").length,
      invited: items.filter((item) => item.status === "invited").length,
      applied: items.filter((item) => item.status === "applied").length,
    },
  };
};

const listMyBookings = async ({ actorUserId, status }) => {
  const vendor = await requireOwnVendor(actorUserId);

  await releaseLapsedStallHolds({ vendorId: vendor._id });
  const query = { vendorId: vendor._id };

  if (status) {
    query.status = status;
  }

  const rows = await EventVendor.find(query)
    .populate("eventId")
    .sort({ createdAt: -1 });

  /* A cancelled event is not a booking any more, and its row would render
     as a card with nothing in it. */
  return {
    items: rows
      .filter((row) => row.eventId)
      .map((row) => mapBooking(row, { event: row.eventId })),
  };
};

/** Events a vendor can apply to: open, upcoming, and not already answered. */
const listOpenEvents = async ({ actorUserId, page = 1, limit = 20 }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);

  const mine = await EventVendor.find({
    vendorId: vendor._id,
    status: { $in: OPEN_STATUSES },
  }).select("eventId");

  const query = {
    status: "published",
    "vendorSettings.acceptingApplications": true,
    startsAt: { $gte: new Date() },
    _id: { $nin: mine.map((row) => row.eventId) },
  };

  const [rows, totalItems] = await Promise.all([
    Event.find(query)
      .select("name startsAt endsAt address imageUrl vendorSettings")
      .sort({ startsAt: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Event.countDocuments(query),
  ]);

  return {
    items: rows.map((event) => ({
      _id: toIdString(event),
      name: event.name,
      startsAt: event.startsAt,
      address: event.address,
      imageUrl: event.imageUrl || "",
      vendorSettings: event.vendorSettings,
    })),
    page: safePage,
    limit: safeLimit,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / safeLimit),
  };
};

module.exports = {
  applyToEvent,
  decideApplication,
  inviteVendor,
  listEventVendors,
  listMyBookings,
  listOpenEvents,
  releaseLapsedStallHolds,
  removeVendorFromEvent,
  respondToInvite,
  updateVendorSettings,
  verifyStallFee,
};
