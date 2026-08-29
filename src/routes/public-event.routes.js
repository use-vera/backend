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
  listPublicFeaturedEventsController,
  listPublicEventCountriesController,
  getPublicEventController,
} = require("../controllers/public-event.controller");
const {
  getPublicEventPageController,
} = require("../controllers/event-page.controller");
const {
  publicSlugParamsSchema,
} = require("../validations/event-page.validation");

// Intentionally has no authMiddleware. This router only ever exposes
// published events with no actor-scoped data (no myTicket, myRating,
// friendsGoingCount, or draft/cancelled organizer history). Used by the
// public marketing site to browse events without requiring an account.
const router = express.Router();

router.get("/", validateQuery(listEventsQuerySchema), listPublicEventsController);
router.get("/featured", listPublicFeaturedEventsController);
router.get("/countries", listPublicEventCountriesController);
router.get(
  "/pages/:slug",
  validateParams(publicSlugParamsSchema),
  getPublicEventPageController,
);

router.get(
  "/:eventId",
  validateParams(eventIdParamsSchema),
  getPublicEventController,
);

module.exports = router;
