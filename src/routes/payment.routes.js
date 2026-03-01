const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  listPaymentAttemptsQuerySchema,
  paymentAttemptParamsSchema,
} = require("../validations/payment.validation");
const {
  paystackWebhookController,
  listPaymentAttemptsController,
  getPaymentAttemptDetailsController,
} = require("../controllers/payment.controller");

const router = express.Router();

router.post(
  "/paystack/webhook",
  express.raw({ type: "application/json" }),
  paystackWebhookController,
);

router.use(authMiddleware);

router.get(
  "/attempts",
  validateQuery(listPaymentAttemptsQuerySchema),
  listPaymentAttemptsController,
);
router.get(
  "/attempts/:attemptId",
  validateParams(paymentAttemptParamsSchema),
  getPaymentAttemptDetailsController,
);

module.exports = router;
