const asyncHandler = require("../utils/async-handler");
const {
  createEvent,
  listEvents,
  listFeaturedEvents,
  listMyEvents,
  getEventById,
  getOrganizerProfileById,
  listEventRatings,
  rateEvent,
  updateEvent,
  deleteEvent,
  initializeTicketPurchase,
  verifyTicketPayment,
  checkInTicket,
  listMyTickets,
  listOrganizerTicketSales,
  getTicketById,
  listEventTickets,
  listEventResaleMarketplace,
  createTicketResale,
  cancelTicketResale,
  listTicketResaleBids,
  createTicketResaleBid,
  acceptTicketResaleBid,
  rejectTicketResaleBid,
  purchaseResaleTicket,
  initializeResalePurchase,
  verifyResalePurchase,
  listTicketTodos,
  createTicketTodo,
  updateTicketTodo,
  deleteTicketTodo,
  listEventFeed,
  getEventReminder,
  upsertEventReminder,
  listEventChatMessages,
  createEventChatMessage,
  updateEventChatMessage,
  deleteEventChatMessage,
  listEventPosts,
  createEventPost,
  toggleEventPostLike,
  listEventPostComments,
  createEventPostComment,
} = require("../services/event.service");
const { emitEventChatMessageCreated } = require("../realtime/socket-broker");

const createEventController = asyncHandler(async (req, res) => {
  const result = await createEvent({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Event created",
    data: result,
  });
});

const listEventsController = asyncHandler(async (req, res) => {
  const result = await listEvents({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    sort: req.query.sort,
    filter: req.query.filter,
    from: req.query.from,
    to: req.query.to,
    ticketType: req.query.ticketType,
    workspaceId: req.query.workspaceId,
  });

  res.status(200).json({
    success: true,
    message: "Events fetched",
    data: result,
  });
});

const listEventFeedController = asyncHandler(async (req, res) => {
  const result = await listEventFeed({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    scope: req.query.scope,
    search: req.query.search,
  });

  res.status(200).json({
    success: true,
    message: "Event feed fetched",
    data: result,
  });
});

const listFeaturedEventsController = asyncHandler(async (req, res) => {
  const result = await listFeaturedEvents({
    actorUserId: req.auth.userId,
    limit: req.query.limit,
    workspaceId: req.query.workspaceId,
  });

  res.status(200).json({
    success: true,
    message: "Featured events fetched",
    data: result,
  });
});

const listMyEventsController = asyncHandler(async (req, res) => {
  const result = await listMyEvents({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "My events fetched",
    data: result,
  });
});

const getEventController = asyncHandler(async (req, res) => {
  const result = await getEventById({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Event fetched",
    data: result,
  });
});

const getOrganizerProfileController = asyncHandler(async (req, res) => {
  const result = await getOrganizerProfileById({
    organizerUserId: req.params.organizerId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Organizer profile fetched",
    data: result,
  });
});

const listEventRatingsController = asyncHandler(async (req, res) => {
  const result = await listEventRatings({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Event ratings fetched",
    data: result,
  });
});

const rateEventController = asyncHandler(async (req, res) => {
  const result = await rateEvent({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Event rating saved",
    data: result,
  });
});

const getEventReminderController = asyncHandler(async (req, res) => {
  const result = await getEventReminder({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Event reminders fetched",
    data: result,
  });
});

const updateEventReminderController = asyncHandler(async (req, res) => {
  const result = await upsertEventReminder({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Event reminders updated",
    data: result,
  });
});

const listEventChatController = asyncHandler(async (req, res) => {
  const result = await listEventChatMessages({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Event chat fetched",
    data: result,
  });
});

const createEventChatMessageController = asyncHandler(async (req, res) => {
  const result = await createEventChatMessage({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  emitEventChatMessageCreated({
    eventId: req.params.eventId,
    message: result,
  });

  res.status(201).json({
    success: true,
    message: "Message sent",
    data: result,
  });
});

const updateEventChatMessageController = asyncHandler(async (req, res) => {
  const result = await updateEventChatMessage({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    messageId: req.params.messageId,
    payload: req.body,
  });

  emitEventChatMessageCreated({
    eventId: req.params.eventId,
    message: result,
  });

  res.status(200).json({
    success: true,
    message: "Message updated",
    data: result,
  });
});

const deleteEventChatMessageController = asyncHandler(async (req, res) => {
  const result = await deleteEventChatMessage({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    messageId: req.params.messageId,
  });

  emitEventChatMessageCreated({
    eventId: req.params.eventId,
    message: result,
  });

  res.status(200).json({
    success: true,
    message: "Message unsent",
    data: result,
  });
});

const listEventPostsController = asyncHandler(async (req, res) => {
  const result = await listEventPosts({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Event posts fetched",
    data: result,
  });
});

const createEventPostController = asyncHandler(async (req, res) => {
  const result = await createEventPost({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Event post created",
    data: result,
  });
});

const toggleEventPostLikeController = asyncHandler(async (req, res) => {
  const result = await toggleEventPostLike({
    postId: req.params.postId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: result.liked ? "Post liked" : "Like removed",
    data: result,
  });
});

const listEventPostCommentsController = asyncHandler(async (req, res) => {
  const result = await listEventPostComments({
    postId: req.params.postId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Post comments fetched",
    data: result,
  });
});

const createEventPostCommentController = asyncHandler(async (req, res) => {
  const result = await createEventPostComment({
    postId: req.params.postId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Comment added",
    data: result,
  });
});

const updateEventController = asyncHandler(async (req, res) => {
  const result = await updateEvent({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Event updated",
    data: result,
  });
});

const deleteEventController = asyncHandler(async (req, res) => {
  const result = await deleteEvent({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Event deleted",
    data: result,
  });
});

const initializeTicketPurchaseController = asyncHandler(async (req, res) => {
  const result = await initializeTicketPurchase({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: result.requiresPayment
      ? "Ticket reservation created. Complete payment to activate it"
      : "Ticket issued",
    data: result,
  });
});

const verifyTicketPaymentController = asyncHandler(async (req, res) => {
  const result = await verifyTicketPayment({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    reference: req.body.reference,
  });

  res.status(200).json({
    success: true,
    message: "Ticket payment verified",
    data: result,
  });
});

const checkInTicketController = asyncHandler(async (req, res) => {
  const result = await checkInTicket({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: result.alreadyUsed ? "Ticket already checked in" : "Ticket checked in",
    data: result,
  });
});

const listMyTicketsController = asyncHandler(async (req, res) => {
  const result = await listMyTickets({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "My tickets fetched",
    data: result,
  });
});

const listOrganizerTicketSalesController = asyncHandler(async (req, res) => {
  const result = await listOrganizerTicketSales({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "Ticket sales fetched",
    data: result,
  });
});

const getTicketController = asyncHandler(async (req, res) => {
  const result = await getTicketById({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Ticket fetched",
    data: result,
  });
});

const listEventTicketsController = asyncHandler(async (req, res) => {
  const result = await listEventTickets({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "Event tickets fetched",
    data: result,
  });
});

const listEventResaleMarketplaceController = asyncHandler(async (req, res) => {
  const result = await listEventResaleMarketplace({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Resale marketplace fetched",
    data: result,
  });
});

const createTicketResaleController = asyncHandler(async (req, res) => {
  const result = await createTicketResale({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Ticket listed for resale",
    data: result,
  });
});

const cancelTicketResaleController = asyncHandler(async (req, res) => {
  const result = await cancelTicketResale({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Ticket resale cancelled",
    data: result,
  });
});

const initializeResalePurchaseController = asyncHandler(async (req, res) => {
  const result = await initializeResalePurchase({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: result.requiresPayment
      ? "Resale checkout initialized. Complete payment to claim the ticket"
      : "Resale ticket transferred",
    data: result,
  });
});

const verifyResalePurchaseController = asyncHandler(async (req, res) => {
  const result = await verifyResalePurchase({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    reference: req.body.reference,
  });

  res.status(200).json({
    success: true,
    message: "Resale payment verified",
    data: result,
  });
});

const listTicketResaleBidsController = asyncHandler(async (req, res) => {
  const result = await listTicketResaleBids({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Ticket bids fetched",
    data: result,
  });
});

const createTicketResaleBidController = asyncHandler(async (req, res) => {
  const result = await createTicketResaleBid({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Bid placed",
    data: result,
  });
});

const acceptTicketResaleBidController = asyncHandler(async (req, res) => {
  const result = await acceptTicketResaleBid({
    ticketId: req.params.ticketId,
    bidId: req.params.bidId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Bid accepted",
    data: result,
  });
});

const rejectTicketResaleBidController = asyncHandler(async (req, res) => {
  const result = await rejectTicketResaleBid({
    ticketId: req.params.ticketId,
    bidId: req.params.bidId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Bid rejected",
    data: result,
  });
});

const purchaseResaleTicketController = asyncHandler(async (req, res) => {
  const result = await purchaseResaleTicket({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Resale ticket purchased",
    data: result,
  });
});

const listTicketTodosController = asyncHandler(async (req, res) => {
  const result = await listTicketTodos({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Ticket todos fetched",
    data: result,
  });
});

const createTicketTodoController = asyncHandler(async (req, res) => {
  const result = await createTicketTodo({
    ticketId: req.params.ticketId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Ticket todo created",
    data: result,
  });
});

const updateTicketTodoController = asyncHandler(async (req, res) => {
  const result = await updateTicketTodo({
    ticketId: req.params.ticketId,
    todoId: req.params.todoId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Ticket todo updated",
    data: result,
  });
});

const deleteTicketTodoController = asyncHandler(async (req, res) => {
  const result = await deleteTicketTodo({
    ticketId: req.params.ticketId,
    todoId: req.params.todoId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Ticket todo deleted",
    data: result,
  });
});

module.exports = {
  createEventController,
  listEventsController,
  listEventFeedController,
  listFeaturedEventsController,
  listMyEventsController,
  getEventController,
  getOrganizerProfileController,
  listEventRatingsController,
  rateEventController,
  getEventReminderController,
  updateEventReminderController,
  listEventChatController,
  createEventChatMessageController,
  updateEventChatMessageController,
  deleteEventChatMessageController,
  listEventPostsController,
  createEventPostController,
  toggleEventPostLikeController,
  listEventPostCommentsController,
  createEventPostCommentController,
  updateEventController,
  deleteEventController,
  initializeTicketPurchaseController,
  verifyTicketPaymentController,
  checkInTicketController,
  listMyTicketsController,
  listOrganizerTicketSalesController,
  getTicketController,
  listEventTicketsController,
  listEventResaleMarketplaceController,
  createTicketResaleController,
  cancelTicketResaleController,
  listTicketResaleBidsController,
  createTicketResaleBidController,
  acceptTicketResaleBidController,
  rejectTicketResaleBidController,
  initializeResalePurchaseController,
  verifyResalePurchaseController,
  purchaseResaleTicketController,
  listTicketTodosController,
  createTicketTodoController,
  updateTicketTodoController,
  deleteTicketTodoController,
};
