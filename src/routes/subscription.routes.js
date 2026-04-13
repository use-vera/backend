const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateBody } = require("../middlewares/validate.middleware");
const {
  initializePremiumSubscriptionSchema,
  verifyPremiumSubscriptionSchema,
} = require("../validations/subscription.validation");
const {
  getMySubscriptionController,
  initializePremiumSubscriptionController,
  verifyPremiumSubscriptionController,
  restorePremiumSubscriptionController,
} = require("../controllers/subscription.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/premium/me", getMySubscriptionController);
router.post(
  "/premium/initialize",
  validateBody(initializePremiumSubscriptionSchema),
  initializePremiumSubscriptionController,
);
router.post(
  "/premium/verify",
  validateBody(verifyPremiumSubscriptionSchema),
  verifyPremiumSubscriptionController,
);
router.post("/premium/restore", restorePremiumSubscriptionController);

module.exports = router;

