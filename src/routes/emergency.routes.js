const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateBody, validateParams } = require("../middlewares/validate.middleware");
const { rateLimit } = require("../middlewares/rate-limit.middleware");
const {
  submitEmergencyReportSchema,
  emergencyIdParamsSchema,
  resolveEmergencySchema,
  broadcastEmergencySchema,
} = require("../validations/emergency.validation");
const { eventIdParamsSchema } = require("../validations/event.validation");
const {
  submitEmergencyReportController,
  getActiveEventEmergencyController,
  listEventEmergenciesController,
  getEmergencyDetailController,
  resolveEmergencyController,
  broadcastEmergencyUpdateController,
  getEventEmergencyAnalyticsController,
} = require("../controllers/emergency.controller");

const router = express.Router();

router.use(authMiddleware);

// Defense-in-depth behind the report cooldown itself — guards a scripted
// client hammering the endpoint faster than the cooldown check runs.
const reportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyFn: (req) => req.auth?.userId,
});

router.post(
  "/reports",
  reportRateLimit,
  validateBody(submitEmergencyReportSchema),
  submitEmergencyReportController,
);

router.get(
  "/events/:eventId/active",
  validateParams(eventIdParamsSchema),
  getActiveEventEmergencyController,
);

router.get(
  "/events/:eventId/analytics",
  validateParams(eventIdParamsSchema),
  getEventEmergencyAnalyticsController,
);

router.get(
  "/events/:eventId",
  validateParams(eventIdParamsSchema),
  listEventEmergenciesController,
);

router.get(
  "/:emergencyId",
  validateParams(emergencyIdParamsSchema),
  getEmergencyDetailController,
);

router.patch(
  "/:emergencyId/resolve",
  validateParams(emergencyIdParamsSchema),
  validateBody(resolveEmergencySchema),
  resolveEmergencyController,
);

router.post(
  "/:emergencyId/broadcast",
  validateParams(emergencyIdParamsSchema),
  validateBody(broadcastEmergencySchema),
  broadcastEmergencyUpdateController,
);

module.exports = router;
