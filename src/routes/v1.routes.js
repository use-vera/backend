const express = require("express");
const ApiError = require("../utils/api-error");
const apiKeyAuthMiddleware = require("../middlewares/api-key-auth.middleware");
const apiRequestLogMiddleware = require("../middlewares/api-request-log.middleware");
const requireScopes = require("../middlewares/require-scopes.middleware");
const v1ErrorMiddleware = require("../middlewares/v1-error.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  paginationQuerySchema,
  eventParamsSchema,
  orderParamsSchema,
  checkoutSessionParamsSchema,
  createCheckoutSessionSchema,
  verifyTicketSchema,
  checkInTicketSchema,
  createRefundSchema,
} = require("../validations/v1.validation");
const {
  listEventsController,
  getEventController,
  listEventTicketTypesController,
} = require("../controllers/v1-event.controller");
const {
  createCheckoutSessionController,
  getCheckoutSessionController,
} = require("../controllers/v1-checkout.controller");
const { listOrdersController, getOrderController } = require("../controllers/v1-order.controller");
const {
  verifyTicketController,
  checkInTicketController,
} = require("../controllers/v1-ticket.controller");
const { createRefundController } = require("../controllers/v1-refund.controller");

const router = express.Router();

router.use(apiKeyAuthMiddleware);
router.use(apiRequestLogMiddleware);

router.get(
  "/events",
  requireScopes("events:read"),
  validateQuery(paginationQuerySchema),
  listEventsController,
);
router.get(
  "/events/:eventId",
  requireScopes("events:read"),
  validateParams(eventParamsSchema),
  getEventController,
);
router.get(
  "/events/:eventId/tickets",
  requireScopes("events:read"),
  validateParams(eventParamsSchema),
  listEventTicketTypesController,
);

router.post(
  "/checkout/sessions",
  requireScopes("checkout:write"),
  validateBody(createCheckoutSessionSchema),
  createCheckoutSessionController,
);
router.get(
  "/checkout/sessions/:sessionId",
  requireScopes("checkout:write"),
  validateParams(checkoutSessionParamsSchema),
  getCheckoutSessionController,
);

router.get(
  "/orders",
  requireScopes("orders:read"),
  validateQuery(paginationQuerySchema),
  listOrdersController,
);
router.get(
  "/orders/:ticketId",
  requireScopes("orders:read"),
  validateParams(orderParamsSchema),
  getOrderController,
);

router.post(
  "/tickets/verify",
  requireScopes("tickets:verify"),
  validateBody(verifyTicketSchema),
  verifyTicketController,
);
router.post(
  "/tickets/check-in",
  requireScopes("tickets:checkin"),
  validateBody(checkInTicketSchema),
  checkInTicketController,
);

router.post(
  "/refunds",
  requireScopes("refunds:write"),
  validateBody(createRefundSchema),
  createRefundController,
);

router.use((_req, _res, next) => {
  next(new ApiError(404, "Route not found", null, "NOT_FOUND"));
});

// Scoped to this sub-router only — never touches the internal API's
// error.middleware.js.
router.use(v1ErrorMiddleware);

module.exports = router;
