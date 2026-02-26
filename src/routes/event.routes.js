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
  listFeaturedEventsQuerySchema,
  listMyEventsQuerySchema,
  eventIdParamsSchema,
  ticketIdParamsSchema,
  postIdParamsSchema,
  initializeTicketPurchaseSchema,
  verifyTicketPaymentSchema,
  ticketCheckInSchema,
  listMyTicketsQuerySchema,
  listOrganizerTicketSalesQuerySchema,
  listEventRatingsQuerySchema,
  rateEventSchema,
  listEventFeedQuerySchema,
  eventReminderSchema,
  eventChatMessageBodySchema,
  eventChatQuerySchema,
  createEventPostSchema,
  listEventPostsQuerySchema,
  createEventPostCommentSchema,
  listEventPostCommentsQuerySchema,
} = require("../validations/event.validation");
const {
  createEventController,
  listEventsController,
  listFeaturedEventsController,
  listMyEventsController,
  getEventController,
  listEventRatingsController,
  rateEventController,
  updateEventController,
  deleteEventController,
  initializeTicketPurchaseController,
  verifyTicketPaymentController,
  checkInTicketController,
  listMyTicketsController,
  listOrganizerTicketSalesController,
  getTicketController,
  listEventTicketsController,
  listEventFeedController,
  getEventReminderController,
  updateEventReminderController,
  listEventChatController,
  createEventChatMessageController,
  listEventPostsController,
  createEventPostController,
  toggleEventPostLikeController,
  listEventPostCommentsController,
  createEventPostCommentController,
} = require("../controllers/event.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/", validateQuery(listEventsQuerySchema), listEventsController);
router.get("/feed", validateQuery(listEventFeedQuerySchema), listEventFeedController);
router.get(
  "/featured",
  validateQuery(listFeaturedEventsQuerySchema),
  listFeaturedEventsController,
);
router.get("/mine", validateQuery(listMyEventsQuerySchema), listMyEventsController);
router.post("/", validateBody(createEventSchema), createEventController);

router.get(
  "/tickets/me",
  validateQuery(listMyTicketsQuerySchema),
  listMyTicketsController,
);
router.get(
  "/tickets/sales",
  validateQuery(listOrganizerTicketSalesQuerySchema),
  listOrganizerTicketSalesController,
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

router.get(
  "/:eventId/ratings",
  validateParams(eventIdParamsSchema),
  validateQuery(listEventRatingsQuerySchema),
  listEventRatingsController,
);
router.post(
  "/:eventId/ratings",
  validateParams(eventIdParamsSchema),
  validateBody(rateEventSchema),
  rateEventController,
);
router.get(
  "/:eventId/reminders/me",
  validateParams(eventIdParamsSchema),
  getEventReminderController,
);
router.post(
  "/:eventId/reminders/me",
  validateParams(eventIdParamsSchema),
  validateBody(eventReminderSchema),
  updateEventReminderController,
);
router.get(
  "/:eventId/chat",
  validateParams(eventIdParamsSchema),
  validateQuery(eventChatQuerySchema),
  listEventChatController,
);
router.post(
  "/:eventId/chat",
  validateParams(eventIdParamsSchema),
  validateBody(eventChatMessageBodySchema),
  createEventChatMessageController,
);
router.get(
  "/:eventId/posts",
  validateParams(eventIdParamsSchema),
  validateQuery(listEventPostsQuerySchema),
  listEventPostsController,
);
router.post(
  "/:eventId/posts",
  validateParams(eventIdParamsSchema),
  validateBody(createEventPostSchema),
  createEventPostController,
);
router.post(
  "/posts/:postId/likes/toggle",
  validateParams(postIdParamsSchema),
  toggleEventPostLikeController,
);
router.get(
  "/posts/:postId/comments",
  validateParams(postIdParamsSchema),
  validateQuery(listEventPostCommentsQuerySchema),
  listEventPostCommentsController,
);
router.post(
  "/posts/:postId/comments",
  validateParams(postIdParamsSchema),
  validateBody(createEventPostCommentSchema),
  createEventPostCommentController,
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
