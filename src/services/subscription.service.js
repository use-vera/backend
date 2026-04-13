const ApiError = require("../utils/api-error");
const env = require("../config/env");
const User = require("../models/user.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const {
  generatePaystackReference,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} = require("./paystack.service");

const PREMIUM_PRICE_NAIRA = 4999;
const PREMIUM_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const toIdString = (value) => String(value?._id || value || "");

const buildCancelActionUrl = (callbackUrl) => {
  const base = String(callbackUrl || "").trim();

  if (!base) {
    return "";
  }

  return `${base}${base.includes("?") ? "&" : "?"}paystack_status=cancelled`;
};

const mapSubscriptionForResponse = (user) => ({
  subscriptionTier: user.subscriptionTier || "free",
  subscriptionStatus: user.subscriptionStatus || "inactive",
  premiumActivatedAt: user.premiumActivatedAt || null,
  premiumExpiresAt: user.premiumExpiresAt || null,
  premiumPriceNaira: PREMIUM_PRICE_NAIRA,
});

const syncUserSubscriptionState = async ({
  user,
  userId,
  now = new Date(),
} = {}) => {
  const targetUser =
    user || (userId ? await User.findById(userId) : null);

  if (!targetUser) {
    throw new ApiError(404, "User not found");
  }

  const next = {
    subscriptionTier: targetUser.subscriptionTier || "free",
    subscriptionStatus: targetUser.subscriptionStatus || "inactive",
  };

  const expiresAt = targetUser.premiumExpiresAt
    ? new Date(targetUser.premiumExpiresAt)
    : null;
  const hasValidExpiry = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()));
  const isPremiumActive =
    next.subscriptionTier === "premium" &&
    hasValidExpiry &&
    Number(expiresAt.getTime()) > Number(now.getTime());

  if (isPremiumActive) {
    next.subscriptionStatus = "active";
  } else if (next.subscriptionTier === "premium") {
    next.subscriptionTier = "free";
    next.subscriptionStatus = "expired";
  } else if (next.subscriptionStatus === "active") {
    next.subscriptionStatus = "inactive";
  }

  const changed =
    targetUser.subscriptionTier !== next.subscriptionTier ||
    targetUser.subscriptionStatus !== next.subscriptionStatus;

  if (changed) {
    targetUser.subscriptionTier = next.subscriptionTier;
    targetUser.subscriptionStatus = next.subscriptionStatus;
    await targetUser.save();
  }

  return {
    user: targetUser,
    subscription: mapSubscriptionForResponse(targetUser),
  };
};

const activatePremiumForUser = async ({ user, now = new Date() }) => {
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const previousExpiry = user.premiumExpiresAt
    ? new Date(user.premiumExpiresAt)
    : null;
  const hasFutureExpiry = Boolean(
    previousExpiry && !Number.isNaN(previousExpiry.getTime()) && previousExpiry > now,
  );
  const activationStart = hasFutureExpiry ? previousExpiry : now;
  const nextExpiry = new Date(
    Number(activationStart.getTime()) + PREMIUM_DURATION_MS,
  );

  user.subscriptionTier = "premium";
  user.subscriptionStatus = "active";
  user.premiumActivatedAt = now;
  user.premiumExpiresAt = nextExpiry;
  await user.save();

  return mapSubscriptionForResponse(user);
};

const getMySubscription = async ({ actorUserId }) => {
  const { subscription } = await syncUserSubscriptionState({
    userId: actorUserId,
  });

  return subscription;
};

const initializePremiumSubscription = async ({
  actorUserId,
  callbackUrl,
}) => {
  const user = await User.findById(actorUserId);

  if (!user) {
    throw new ApiError(404, "User account not found");
  }

  await syncUserSubscriptionState({ user });

  const shouldBypassPaystack = !env.paystackSecretKey && env.paystackDevBypass;

  if (!env.paystackSecretKey && !shouldBypassPaystack) {
    throw new ApiError(
      503,
      "Premium checkout is not configured yet. Set PAYSTACK_SECRET_KEY.",
    );
  }

  if (shouldBypassPaystack) {
    const subscription = await activatePremiumForUser({ user });

    return {
      requiresPayment: false,
      payment: null,
      paymentAttemptId: null,
      kind: "premium_subscription",
      subscription,
      pricing: {
        amountNaira: PREMIUM_PRICE_NAIRA,
      },
    };
  }

  const reference = generatePaystackReference(
    "premium_subscription",
    String(actorUserId),
  );
  const normalizedCallbackUrl = String(
    callbackUrl || env.paystackCallbackUrl || "",
  ).trim();
  const cancelActionUrl = buildCancelActionUrl(normalizedCallbackUrl);
  const attempt = await PaymentAttempt.create({
    reference,
    provider: "paystack",
    kind: "premium_subscription",
    buyerUserId: actorUserId,
    eventId: null,
    amountKobo: PREMIUM_PRICE_NAIRA * 100,
    currency: "NGN",
    callbackUrl: normalizedCallbackUrl,
  });

  try {
    const paymentData = await initializePaystackTransaction({
      email: String(user.email || "").trim().toLowerCase(),
      amountKobo: attempt.amountKobo,
      callbackUrl: normalizedCallbackUrl || undefined,
      reference,
      metadata: {
        source: "vera-mobile",
        kind: "premium_subscription",
        paymentAttemptId: String(attempt._id),
        buyerUserId: String(actorUserId),
        ...(cancelActionUrl ? { cancel_action: cancelActionUrl } : {}),
      },
    });

    attempt.authorizationUrl = String(
      paymentData.authorization_url || "",
    ).trim();
    attempt.accessCode = String(paymentData.access_code || "").trim();
    attempt.paystackInitializePayload = paymentData;
    await attempt.save();
  } catch (error) {
    attempt.status = "failed";
    attempt.fulfillmentStatus = "failed";
    attempt.failureReason =
      error instanceof Error ? error.message : String(error);
    await attempt.save();
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
    kind: "premium_subscription",
    subscription: mapSubscriptionForResponse(user),
    pricing: {
      amountNaira: PREMIUM_PRICE_NAIRA,
    },
  };
};

const finalizePremiumSubscriptionPaymentAttempt = async ({
  paymentAttempt,
  paymentData,
  now = new Date(),
}) => {
  if (!paymentAttempt || paymentAttempt.kind !== "premium_subscription") {
    throw new ApiError(400, "Invalid premium payment attempt");
  }

  const user = await User.findById(paymentAttempt.buyerUserId);

  if (!user) {
    throw new ApiError(404, "Subscription user not found");
  }

  if (paymentAttempt.fulfillmentStatus === "done") {
    const { subscription } = await syncUserSubscriptionState({
      user,
      now,
    });

    return subscription;
  }

  const subscription = await activatePremiumForUser({
    user,
    now,
  });

  paymentAttempt.status = "success";
  paymentAttempt.paystackVerifyPayload =
    paymentData || paymentAttempt.paystackVerifyPayload;
  paymentAttempt.fulfillmentStatus = "done";
  paymentAttempt.fulfilledAt = paymentAttempt.fulfilledAt || now;
  paymentAttempt.failureReason = "";
  await paymentAttempt.save();

  return subscription;
};

const verifyPremiumSubscription = async ({
  actorUserId,
  reference,
  paymentAttemptId,
}) => {
  const referenceText = String(reference || "").trim();
  const attemptIdText = String(paymentAttemptId || "").trim();
  let attempt = null;

  if (attemptIdText) {
    attempt = await PaymentAttempt.findById(attemptIdText);
  }

  if (!attempt && referenceText) {
    attempt = await PaymentAttempt.findOne({
      reference: referenceText,
      kind: "premium_subscription",
      buyerUserId: actorUserId,
    }).sort({ createdAt: -1 });
  }

  if (!attempt) {
    attempt = await PaymentAttempt.findOne({
      kind: "premium_subscription",
      buyerUserId: actorUserId,
      status: { $in: ["initialized", "success"] },
    }).sort({ createdAt: -1 });
  }

  if (!attempt) {
    throw new ApiError(404, "Could not find a premium payment to verify");
  }

  if (toIdString(attempt.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only verify your own premium payment");
  }

  if (attempt.fulfillmentStatus === "done") {
    const { subscription } = await syncUserSubscriptionState({
      userId: actorUserId,
    });

    return {
      subscription,
      paymentStatus: "success",
      alreadyVerified: true,
    };
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

    throw new ApiError(402, "Payment has not been completed", {
      paymentStatus,
    });
  }

  const amountKobo = Number(paymentData.amount || 0);
  const expectedKobo = Math.round(Number(attempt.amountKobo || 0));
  const receivedCurrency = String(
    paymentData.currency || attempt.currency || "NGN",
  ).toUpperCase();
  const expectedCurrency = String(attempt.currency || "NGN").toUpperCase();

  if (receivedCurrency !== expectedCurrency || amountKobo < expectedKobo) {
    attempt.status = "failed";
    attempt.paystackVerifyPayload = paymentData;
    attempt.fulfillmentStatus = "failed";
    attempt.failureReason = "Amount or currency mismatch";
    await attempt.save();

    throw new ApiError(409, "Paid amount is below expected premium amount", {
      amountKobo,
      expectedKobo,
      receivedCurrency,
      expectedCurrency,
    });
  }

  const subscription = await finalizePremiumSubscriptionPaymentAttempt({
    paymentAttempt: attempt,
    paymentData,
  });

  return {
    subscription,
    paymentStatus,
    alreadyVerified: false,
  };
};

const restorePremiumSubscription = async ({ actorUserId }) =>
  getMySubscription({ actorUserId });

module.exports = {
  PREMIUM_PRICE_NAIRA,
  mapSubscriptionForResponse,
  syncUserSubscriptionState,
  initializePremiumSubscription,
  verifyPremiumSubscription,
  restorePremiumSubscription,
  finalizePremiumSubscriptionPaymentAttempt,
};

