const asyncHandler = require("../utils/async-handler");
const { sendV1Success } = require("../utils/v1-response");
const {
  createCheckoutSession,
  getCheckoutSession,
} = require("../services/checkout-session.service");

const createCheckoutSessionController = asyncHandler(async (req, res) => {
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim() || null;

  const result = await createCheckoutSession({
    apiKeyId: req.apiAuth.apiKeyId,
    workspaceId: req.apiAuth.workspaceId,
    payload: req.body,
    idempotencyKey,
  });

  sendV1Success(res, { status: 201, data: result });
});

const getCheckoutSessionController = asyncHandler(async (req, res) => {
  const result = await getCheckoutSession({
    workspaceId: req.apiAuth.workspaceId,
    sessionId: req.params.sessionId,
  });

  sendV1Success(res, { data: result });
});

module.exports = { createCheckoutSessionController, getCheckoutSessionController };
