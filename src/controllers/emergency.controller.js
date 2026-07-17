const asyncHandler = require("../utils/async-handler");
const {
  submitEmergencyReport,
  getActiveEmergencyForAttendee,
  listEventEmergencies,
  getEmergencyDetail,
  resolveEmergency,
  broadcastManualUpdate,
  getEventEmergencyAnalytics,
} = require("../services/emergency.service");

const submitEmergencyReportController = asyncHandler(async (req, res) => {
  const result = await submitEmergencyReport({
    actorUserId: req.auth.userId,
    ...req.body,
  });

  res.status(201).json({
    success: true,
    message: "Emergency report submitted",
    data: result,
  });
});

const getActiveEventEmergencyController = asyncHandler(async (req, res) => {
  const emergency = await getActiveEmergencyForAttendee({ eventId: req.params.eventId });

  res.json({
    success: true,
    message: "Active emergency fetched",
    data: emergency,
  });
});

const listEventEmergenciesController = asyncHandler(async (req, res) => {
  const emergencies = await listEventEmergencies({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.json({
    success: true,
    message: "Event emergencies fetched",
    data: emergencies,
  });
});

const getEmergencyDetailController = asyncHandler(async (req, res) => {
  const result = await getEmergencyDetail({
    emergencyId: req.params.emergencyId,
    actorUserId: req.auth.userId,
  });

  res.json({
    success: true,
    message: "Emergency detail fetched",
    data: result,
  });
});

const resolveEmergencyController = asyncHandler(async (req, res) => {
  const emergency = await resolveEmergency({
    emergencyId: req.params.emergencyId,
    actorUserId: req.auth.userId,
    ...req.body,
  });

  res.json({
    success: true,
    message: "Emergency resolved",
    data: emergency,
  });
});

const broadcastEmergencyUpdateController = asyncHandler(async (req, res) => {
  const emergency = await broadcastManualUpdate({
    emergencyId: req.params.emergencyId,
    actorUserId: req.auth.userId,
    message: req.body.message,
  });

  res.json({
    success: true,
    message: "Update broadcast",
    data: emergency,
  });
});

const getEventEmergencyAnalyticsController = asyncHandler(async (req, res) => {
  const analytics = await getEventEmergencyAnalytics({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.json({
    success: true,
    message: "Emergency analytics fetched",
    data: analytics,
  });
});

module.exports = {
  submitEmergencyReportController,
  getActiveEventEmergencyController,
  listEventEmergenciesController,
  getEmergencyDetailController,
  resolveEmergencyController,
  broadcastEmergencyUpdateController,
  getEventEmergencyAnalyticsController,
};
