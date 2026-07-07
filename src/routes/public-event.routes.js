const express = require("express");
const {
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  listEventsQuerySchema,
  eventIdParamsSchema,
} = require("../validations/event.validation");
const {
  listPublicEventsController,
  getPublicEventController,
} = require("../controllers/public-event.controller");

// Intentionally has no authMiddleware — this router only ever exposes
// published events with no actor-scoped data (no myTicket, myRating,
// friendsGoingCount, or draft/cancelled organizer history). Used by the
// public marketing site to browse events without requiring an account.
const router = express.Router();

router.get("/", validateQuery(listEventsQuerySchema), listPublicEventsController);
router.get(
  "/:eventId",
  validateParams(eventIdParamsSchema),
  getPublicEventController,
);

module.exports = router;
