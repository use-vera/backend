const asyncHandler = require("../utils/async-handler");
const {
  getMySubscription,
  initializePremiumSubscription,
  verifyPremiumSubscription,
  restorePremiumSubscription,
} = require("../services/subscription.service");

const getMySubscriptionController = asyncHandler(async (req, res) => {
  const result = await getMySubscription({
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Subscription fetched",
    data: result,
  });
});

const initializePremiumSubscriptionController = asyncHandler(
  async (req, res) => {
    const result = await initializePremiumSubscription({
      actorUserId: req.auth.userId,
      callbackUrl: req.body?.callbackUrl,
    });

    res.status(201).json({
      success: true,
      message: result.requiresPayment
        ? "Premium checkout initialized"
        : "Premium activated",
      data: result,
    });
  },
);

const verifyPremiumSubscriptionController = asyncHandler(async (req, res) => {
  const result = await verifyPremiumSubscription({
    actorUserId: req.auth.userId,
    reference: req.body?.reference,
    paymentAttemptId: req.body?.paymentAttemptId,
  });

  res.status(200).json({
    success: true,
    message: "Premium payment verified",
    data: result,
  });
});

const restorePremiumSubscriptionController = asyncHandler(async (req, res) => {
  const result = await restorePremiumSubscription({
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Subscription restored",
    data: result,
  });
});

module.exports = {
  getMySubscriptionController,
  initializePremiumSubscriptionController,
  verifyPremiumSubscriptionController,
  restorePremiumSubscriptionController,
};

