const ApiError = require("../utils/api-error");
const env = require("../config/env");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const FeaturedEventSlot = require("../models/featured-event-slot.model");
const {
  generatePaystackReference,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} = require("./paystack.service");

const FEATURE_FEE_PER_DAY_NAIRA = 2000;
const MAX_SLOTS_PER_DAY = 10;
const MAX_DAYS_PER_PURCHASE = 30;

const toIdString = (value) => String(value?._id || value || "");

const toDateKey = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "Invalid date");
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const todayDateKey = () => toDateKey(new Date());

const buildDateRange = (startDate, days) => {
  const dayCount = Math.max(1, Math.min(MAX_DAYS_PER_PURCHASE, Number(days) || 1));
  const start = new Date(`${toDateKey(startDate)}T00:00:00.000Z`);
  const dates = [];

  for (let i = 0; i < dayCount; i += 1) {
    const next = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(toDateKey(next));
  }

  return dates;
};

const countActiveSlotsForDates = async (dates) => {
  const rows = await FeaturedEventSlot.aggregate([
    {
      $match: {
        date: { $in: dates },
        status: { $in: ["pending_payment", "active"] },
      },
    },
    { $group: { _id: "$date", count: { $sum: 1 } } },
  ]);

  const countByDate = new Map(rows.map((row) => [row._id, row.count]));

  return dates.map((date) => ({
    date,
    reserved: countByDate.get(date) || 0,
    remaining: Math.max(0, MAX_SLOTS_PER_DAY - (countByDate.get(date) || 0)),
  }));
};

const checkFeatureAvailability = async ({ startDate, days }) => {
  if (!startDate) {
    throw new ApiError(400, "A start date is required");
  }

  const dates = buildDateRange(startDate, days);
  const availability = await countActiveSlotsForDates(dates);
  const totalDays = availability.length;
  const allAvailable = availability.every((entry) => entry.remaining > 0);

  return {
    availability,
    allAvailable,
    feePerDayNaira: FEATURE_FEE_PER_DAY_NAIRA,
    totalNaira: FEATURE_FEE_PER_DAY_NAIRA * totalDays,
  };
};

const initializeEventFeature = async ({
  actorUserId,
  eventId,
  startDate,
  days,
  callbackUrl,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (toIdString(event.organizerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "Only the organizer can feature this event");
  }

  if (event.status !== "published") {
    throw new ApiError(400, "Only published events can be featured");
  }

  const dates = buildDateRange(startDate, days);
  const eventEndKey = toDateKey(event.endsAt);

  if (dates.some((date) => date > eventEndKey)) {
    throw new ApiError(
      400,
      "You can't feature an event past its own end date",
    );
  }

  const todayKey = todayDateKey();

  if (dates.some((date) => date < todayKey)) {
    throw new ApiError(400, "You can't feature an event on a past date");
  }

  const availability = await countActiveSlotsForDates(dates);
  const unavailableDates = availability.filter((entry) => entry.remaining <= 0);

  if (unavailableDates.length) {
    throw new ApiError(409, "No featured slots left for one or more selected days", {
      unavailableDates: unavailableDates.map((entry) => entry.date),
    });
  }

  const user = await User.findById(actorUserId);

  if (!user) {
    throw new ApiError(404, "User account not found");
  }

  const amountKobo = FEATURE_FEE_PER_DAY_NAIRA * dates.length * 100;
  const reference = generatePaystackReference("event_feature", String(eventId));
  const normalizedCallbackUrl = String(
    callbackUrl || env.paystackCallbackUrl || "",
  ).trim();

  const attempt = await PaymentAttempt.create({
    reference,
    provider: "paystack",
    kind: "event_feature",
    buyerUserId: actorUserId,
    eventId: event._id,
    amountKobo,
    currency: "NGN",
    callbackUrl: normalizedCallbackUrl,
  });

  const slots = await FeaturedEventSlot.insertMany(
    dates.map((date) => ({
      eventId: event._id,
      organizerUserId: actorUserId,
      date,
      paymentAttemptId: attempt._id,
      status: "pending_payment",
    })),
  );

  try {
    const paymentData = await initializePaystackTransaction({
      email: String(user.email || "").trim().toLowerCase(),
      amountKobo,
      callbackUrl: normalizedCallbackUrl || undefined,
      reference,
      metadata: {
        source: "vera-mobile",
        kind: "event_feature",
        paymentAttemptId: String(attempt._id),
        buyerUserId: String(actorUserId),
        eventId: String(event._id),
        featureDates: dates,
      },
    });

    attempt.authorizationUrl = String(paymentData.authorization_url || "").trim();
    attempt.accessCode = String(paymentData.access_code || "").trim();
    attempt.paystackInitializePayload = paymentData;
    await attempt.save();
  } catch (error) {
    attempt.status = "failed";
    attempt.fulfillmentStatus = "failed";
    attempt.failureReason = error instanceof Error ? error.message : String(error);
    await attempt.save();
    await FeaturedEventSlot.updateMany(
      { paymentAttemptId: attempt._id },
      { $set: { status: "cancelled" } },
    );
    throw error;
  }

  return {
    requiresPayment: true,
    payment: {
      reference: attempt.reference,
      authorizationUrl: attempt.authorizationUrl,
      accessCode: attempt.accessCode,
    },
    paymentAttemptId: String(attempt._id),
    dates,
    feePerDayNaira: FEATURE_FEE_PER_DAY_NAIRA,
    totalNaira: FEATURE_FEE_PER_DAY_NAIRA * dates.length,
    slotIds: slots.map((slot) => String(slot._id)),
  };
};

const finalizeEventFeaturePaymentAttempt = async ({
  paymentAttempt,
  paymentData,
  now = new Date(),
}) => {
  if (!paymentAttempt || paymentAttempt.kind !== "event_feature") {
    throw new ApiError(400, "Invalid event feature payment attempt");
  }

  if (paymentAttempt.fulfillmentStatus === "done") {
    return { alreadyFulfilled: true };
  }

  await FeaturedEventSlot.updateMany(
    { paymentAttemptId: paymentAttempt._id, status: "pending_payment" },
    { $set: { status: "active" } },
  );

  paymentAttempt.status = "success";
  paymentAttempt.paystackVerifyPayload =
    paymentData || paymentAttempt.paystackVerifyPayload;
  paymentAttempt.fulfillmentStatus = "done";
  paymentAttempt.fulfilledAt = paymentAttempt.fulfilledAt || now;
  paymentAttempt.failureReason = "";
  await paymentAttempt.save();

  return { alreadyFulfilled: false };
};

const verifyEventFeature = async ({ actorUserId, reference, paymentAttemptId }) => {
  const referenceText = String(reference || "").trim();
  const attemptIdText = String(paymentAttemptId || "").trim();
  let attempt = null;

  if (attemptIdText) {
    attempt = await PaymentAttempt.findById(attemptIdText);
  }

  if (!attempt && referenceText) {
    attempt = await PaymentAttempt.findOne({
      reference: referenceText,
      kind: "event_feature",
      buyerUserId: actorUserId,
    }).sort({ createdAt: -1 });
  }

  if (!attempt) {
    throw new ApiError(404, "Could not find a feature payment to verify");
  }

  if (toIdString(attempt.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only verify your own payment");
  }

  if (attempt.fulfillmentStatus === "done") {
    return { paymentStatus: "success", alreadyVerified: true };
  }

  const paymentReference = String(referenceText || attempt.reference || "").trim();

  if (!paymentReference) {
    throw new ApiError(400, "Payment reference is required for verification");
  }

  const paymentData = await verifyPaystackTransaction(paymentReference);
  const paymentStatus = String(paymentData.status || "").toLowerCase();

  if (paymentStatus !== "success") {
    attempt.status = paymentStatus === "abandoned" ? "abandoned" : "failed";
    attempt.paystackVerifyPayload = paymentData;
    attempt.failureReason = "Payment has not been completed";
    await attempt.save();

    throw new ApiError(402, "Payment has not been completed", { paymentStatus });
  }

  const amountKobo = Number(paymentData.amount || 0);
  const expectedKobo = Math.round(Number(attempt.amountKobo || 0));
  const receivedCurrency = String(paymentData.currency || attempt.currency || "NGN").toUpperCase();
  const expectedCurrency = String(attempt.currency || "NGN").toUpperCase();

  if (receivedCurrency !== expectedCurrency || amountKobo < expectedKobo) {
    attempt.status = "failed";
    attempt.paystackVerifyPayload = paymentData;
    attempt.fulfillmentStatus = "failed";
    attempt.failureReason = "Amount or currency mismatch";
    await attempt.save();

    throw new ApiError(409, "Paid amount is below expected feature amount", {
      amountKobo,
      expectedKobo,
    });
  }

  await finalizeEventFeaturePaymentAttempt({ paymentAttempt: attempt, paymentData });

  return { paymentStatus, alreadyVerified: false };
};

const expireAbandonedFeatureSlots = async ({ olderThanMinutes = 20 } = {}) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  const result = await FeaturedEventSlot.updateMany(
    { status: "pending_payment", createdAt: { $lt: cutoff } },
    { $set: { status: "expired" } },
  );

  return { expiredCount: result.modifiedCount || 0 };
};

module.exports = {
  FEATURE_FEE_PER_DAY_NAIRA,
  MAX_SLOTS_PER_DAY,
  toDateKey,
  todayDateKey,
  checkFeatureAvailability,
  initializeEventFeature,
  verifyEventFeature,
  finalizeEventFeaturePaymentAttempt,
  expireAbandonedFeatureSlots,
};
