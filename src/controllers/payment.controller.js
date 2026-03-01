const asyncHandler = require("../utils/async-handler");
const ApiError = require("../utils/api-error");
const {
  parsePaystackWebhookBody,
  validatePaystackWebhookSignature,
} = require("../services/paystack.service");
const { processPaystackWebhookEvent } = require("../services/event.service");
const {
  createPaymentEventLog,
  listPaymentAttempts,
  getPaymentAttemptDetails,
} = require("../services/payment.service");

const paystackWebhookController = asyncHandler(async (req, res) => {
  const rawBody = req.body;

  if (!Buffer.isBuffer(rawBody)) {
    throw new ApiError(400, "Webhook payload must be raw bytes");
  }

  const signature = req.headers["x-paystack-signature"];
  const rawText = rawBody.toString("utf8");

  if (!validatePaystackWebhookSignature(rawBody, signature)) {
    await createPaymentEventLog({
      provider: "paystack",
      eventType: "unknown",
      status: "invalid_signature",
      message: "Invalid Paystack webhook signature",
      meta: {
        rawBody: rawText.slice(0, 4000),
      },
    }).catch(() => null);

    throw new ApiError(401, "Invalid Paystack webhook signature");
  }

  let payload;

  try {
    payload = parsePaystackWebhookBody(rawBody);
  } catch (error) {
    await createPaymentEventLog({
      provider: "paystack",
      eventType: "unknown",
      status: "failed",
      message: error instanceof Error ? error.message : "Webhook JSON parse failed",
      meta: {
        rawBody: rawText.slice(0, 4000),
      },
    }).catch(() => null);
    throw error;
  }

  const reference = String(payload?.data?.reference || "").trim();
  let result;

  try {
    result = await processPaystackWebhookEvent(payload);
  } catch (error) {
    await createPaymentEventLog({
      provider: "paystack",
      eventType: String(payload?.event || "unknown").trim(),
      reference,
      status: "failed",
      message: error instanceof Error ? error.message : "Webhook processing failed",
      payload,
      meta: {
        rawBody: rawText.slice(0, 4000),
      },
    }).catch(() => null);
    throw error;
  }

  await createPaymentEventLog({
    provider: "paystack",
    eventType: String(payload?.event || "unknown").trim(),
    reference,
    paymentAttemptId: result?.paymentAttemptId || null,
    status: result?.processed ? "processed" : result?.ignored ? "ignored" : "failed",
    message: String(result?.reason || result?.event || "Webhook processed"),
    payload,
    meta: result,
  }).catch(() => null);

  res.status(200).json({
    success: true,
    message: "Webhook processed",
    data: result,
  });
});

const listPaymentAttemptsController = asyncHandler(async (req, res) => {
  const result = await listPaymentAttempts({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    kind: req.query.kind,
    scope: req.query.scope,
    eventId: req.query.eventId,
    search: req.query.search,
  });

  res.status(200).json({
    success: true,
    message: "Payment attempts fetched",
    data: result,
  });
});

const getPaymentAttemptDetailsController = asyncHandler(async (req, res) => {
  const result = await getPaymentAttemptDetails({
    attemptId: req.params.attemptId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Payment attempt fetched",
    data: result,
  });
});

module.exports = {
  paystackWebhookController,
  listPaymentAttemptsController,
  getPaymentAttemptDetailsController,
};
