const asyncHandler = require("../utils/async-handler");
const {
  createEvent,
  listEvents,
  listMyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  initializeTicketPurchase,
  verifyTicketPayment,
  checkInTicket,
  listMyTickets,
  getTicketById,
  listEventTickets,
} = require("../services/event.service");

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

module.exports = {
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
};
