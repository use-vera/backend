const asyncHandler = require("../utils/async-handler");
const {
  createRecurringEvent,
  listRecurringEvents,
  updateRecurringEvent,
  listRecurringEventAttendance,
} = require("../services/recurring-event.service");

const createRecurringEventController = asyncHandler(async (req, res) => {
  const result = await createRecurringEvent({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Recurring event created",
    data: result,
  });
});

const listRecurringEventsController = asyncHandler(async (req, res) => {
  const result = await listRecurringEvents({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Recurring events fetched",
    data: result,
  });
});

const updateRecurringEventController = asyncHandler(async (req, res) => {
  const result = await updateRecurringEvent({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    eventId: req.params.eventId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Recurring event updated",
    data: result,
  });
});

const listRecurringEventAttendanceController = asyncHandler(async (req, res) => {
  const result = await listRecurringEventAttendance({
    workspaceId: req.params.workspaceId,
    actorUserId: req.auth.userId,
    eventId: req.params.eventId,
    date: req.query.date,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Recurring event attendance fetched",
    data: result,
  });
});

module.exports = {
  createRecurringEventController,
  listRecurringEventsController,
  updateRecurringEventController,
  listRecurringEventAttendanceController,
};
