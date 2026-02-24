const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  listMyEventsQuerySchema,
  eventIdParamsSchema,
  ticketIdParamsSchema,
  initializeTicketPurchaseSchema,
  verifyTicketPaymentSchema,
  ticketCheckInSchema,
  listMyTicketsQuerySchema,
} = require("../validations/event.validation");
const {
  createEventController,
  listEventsController,
  listMyEventsController,
  getEventController,
  updateEventController,
  deleteEventController,
  initializeTicketPurchaseController,
  verifyTicketPaymentController,
  checkInTicketController,
  listMyTicketsController,
  getTicketController,
  listEventTicketsController,
} = require("../controllers/event.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/", validateQuery(listEventsQuerySchema), listEventsController);
router.get("/mine", validateQuery(listMyEventsQuerySchema), listMyEventsController);
router.post("/", validateBody(createEventSchema), createEventController);

router.get(
  "/tickets/me",
  validateQuery(listMyTicketsQuerySchema),
  listMyTicketsController,
);
router.post(
  "/tickets/check-in",
  validateBody(ticketCheckInSchema),
  checkInTicketController,
);
router.get(
  "/tickets/:ticketId",
  validateParams(ticketIdParamsSchema),
  getTicketController,
);
router.post(
  "/tickets/:ticketId/verify",
  validateParams(ticketIdParamsSchema),
  validateBody(verifyTicketPaymentSchema),
  verifyTicketPaymentController,
);

router.get("/:eventId", validateParams(eventIdParamsSchema), getEventController);
router.patch(
  "/:eventId",
  validateParams(eventIdParamsSchema),
  validateBody(updateEventSchema),
  updateEventController,
);
router.delete(
  "/:eventId",
  validateParams(eventIdParamsSchema),
  deleteEventController,
);
router.post(
  "/:eventId/tickets/initialize",
  validateParams(eventIdParamsSchema),
  validateBody(initializeTicketPurchaseSchema),
  initializeTicketPurchaseController,
);
router.get(
  "/:eventId/tickets",
  validateParams(eventIdParamsSchema),
  validateQuery(listMyTicketsQuerySchema),
  listEventTicketsController,
);

module.exports = router;
