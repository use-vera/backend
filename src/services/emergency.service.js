const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventEmergency = require("../models/event-emergency.model");
const EmergencyReport = require("../models/emergency-report.model");
const EmergencyAuditLog = require("../models/emergency-audit-log.model");
const { canUserManageEvent } = require("./event.service");
const { ensureAttendeeEligibleToReport } = require("./emergency-geofence-validator.service");
const { computeConfidence } = require("./emergency-confidence-engine.service");
const { broadcastEmergencyAlert } = require("./emergency-notification.service");

const CATEGORY_SEVERITY_WEIGHTS = {
  fire: 1.4,
  structural_collapse: 1.4,
  crowd_crush: 1.4,
  violence: 1.4,
  medical: 1.2,
  security_threat: 1.2,
  weather: 1,
  other: 1,
};

const CATEGORY_LABELS = {
  fire: "Fire",
  medical: "Medical Emergency",
  security_threat: "Security Threat",
  structural_collapse: "Structural Collapse",
  crowd_crush: "Crowd Crush",
  violence: "Violence",
  weather: "Weather",
  other: "Emergency",
};

const CATEGORY_ACTION_REQUIRED = {
  fire: "Please remain calm. Proceed to the nearest emergency exit. Follow venue staff instructions.",
  medical: "Please remain calm. Make way for medical responders and alert venue staff if you can help.",
  security_threat: "Please remain calm. Follow venue staff instructions and move away from the affected area.",
  structural_collapse: "Please remain calm. Move away from the affected structure and follow venue staff instructions.",
  crowd_crush: "Please remain calm. Move slowly away from the crowded area. Do not push. Follow venue staff instructions.",
  violence: "Please remain calm. Move away from the affected area and follow venue staff instructions.",
  weather: "Please remain calm. Seek indoor shelter and follow venue staff instructions.",
  other: "Please remain calm and follow venue staff instructions.",
};

// The "detected" state fires at a lower bar than the full alert threshold —
// it's a visible early-warning signal on the organizer dashboard before
// Vera actually notifies the crowd.
const DETECTION_THRESHOLD_RATIO = 0.5;

// How long a resolved emergency stays around before the monitor tick
// auto-archives it — "Archived" is a housekeeping state, not a manual one.
const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

const resolveEmergencyRadius = (event) =>
  event.emergency?.geofenceRadiusMeters ?? event.geofenceRadiusMeters;

const loadEventOrThrow = async (eventId) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  return event;
};

const loadTicketOrThrow = async (ticketId) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  return ticket;
};

const ensureCanManageEmergency = async (event, actorUserId) => {
  const allowed = await canUserManageEvent(event, actorUserId);

  if (!allowed) {
    throw new ApiError(403, "You cannot manage emergencies for this event");
  }
};

const writeAuditLog = (eventId, { emergencyId = null, actorUserId = null, action, metadata = {} }) =>
  EmergencyAuditLog.create({ eventId, emergencyId, actorUserId, action, metadata });

const findOrCreateActiveEmergency = async ({ eventId, category }) => {
  const existing = await EventEmergency.findOne({ eventId, isActive: true });

  if (existing) {
    return existing;
  }

  try {
    return await EventEmergency.create({
      eventId,
      category,
      status: "monitoring",
      isActive: true,
    });
  } catch (error) {
    // Race: two reports arrived concurrently and both tried to create the
    // active emergency — the partial unique index rejects the loser, who
    // simply re-reads the winner's doc instead of failing the request.
    if (error?.code === 11000) {
      const winner = await EventEmergency.findOne({ eventId, isActive: true });
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
};

const submitEmergencyReport = async ({
  eventId,
  ticketId,
  actorUserId,
  category,
  description = "",
  latitude,
  longitude,
  gpsAccuracy,
  deviceId = "",
}) => {
  const event = await loadEventOrThrow(eventId);
  const ticket = await loadTicketOrThrow(ticketId);

  if (String(ticket.eventId) !== String(eventId)) {
    throw new ApiError(400, "Ticket does not belong to this event");
  }

  const now = new Date();

  ensureAttendeeEligibleToReport({
    event,
    ticket,
    actorUserId,
    latitude,
    longitude,
    gpsAccuracy,
    now,
  });

  const cooldownMs = (event.emergency?.reportCooldownSeconds ?? 60) * 1000;
  const existingReport = await EmergencyReport.findOne({
    eventId,
    attendeeUserId: actorUserId,
  }).sort({ updatedAt: -1 });

  let report;

  if (existingReport && now.getTime() - new Date(existingReport.updatedAt).getTime() < cooldownMs) {
    existingReport.category = category;
    existingReport.description = description;
    existingReport.latitude = latitude;
    existingReport.longitude = longitude;
    existingReport.gpsAccuracy = gpsAccuracy;
    existingReport.deviceId = deviceId;
    existingReport.confidenceWeight = CATEGORY_SEVERITY_WEIGHTS[category] ?? 1;
    report = await existingReport.save();
  } else {
    report = await EmergencyReport.create({
      eventId,
      attendeeUserId: actorUserId,
      ticketId,
      category,
      description,
      latitude,
      longitude,
      gpsAccuracy,
      deviceId,
      confidenceWeight: CATEGORY_SEVERITY_WEIGHTS[category] ?? 1,
    });
  }

  const emergency = await findOrCreateActiveEmergency({ eventId, category });

  if (!report.emergencyId) {
    report.emergencyId = emergency._id;
    await report.save();
  }

  await writeAuditLog(eventId, {
    emergencyId: emergency._id,
    actorUserId,
    action: "report_submitted",
    metadata: { reportId: report._id, category },
  });

  const updatedEmergency = await recomputeEmergencyConfidence(emergency._id);

  return { report, emergency: updatedEmergency };
};

const recomputeEmergencyConfidence = async (emergencyId) => {
  const emergency = await EventEmergency.findById(emergencyId);

  if (!emergency || !emergency.isActive) {
    return emergency;
  }

  const event = await Event.findById(emergency.eventId);
  const reports = await EmergencyReport.find({ emergencyId: emergency._id }).lean();

  const now = new Date();
  const sensitivity = event?.emergency?.sensitivity ?? 1;
  const result = computeConfidence({ reports, now, sensitivity });

  emergency.confidenceScore = result.score;
  emergency.confidenceLevel = result.level;
  emergency.reportCount = reports.length;
  emergency.uniqueReporterCount = result.uniqueReporterCount;
  emergency.reportsPerMinute = result.reportsPerMinute;
  emergency.centroidLatitude = result.centroid?.latitude ?? null;
  emergency.centroidLongitude = result.centroid?.longitude ?? null;

  if (result.modalCategory) {
    emergency.category = result.modalCategory;
  }

  const threshold = event?.emergency?.confidenceThreshold ?? 70;
  const detectionThreshold = threshold * DETECTION_THRESHOLD_RATIO;

  if (emergency.status === "monitoring" && result.score >= detectionThreshold) {
    emergency.status = "detected";
    emergency.detectedAt = now;
    await writeAuditLog(emergency.eventId, {
      emergencyId: emergency._id,
      action: "emergency_detected",
      metadata: { confidenceScore: result.score },
    });
  }

  const shouldAutoAlert =
    (emergency.status === "monitoring" || emergency.status === "detected") &&
    result.score >= threshold &&
    event?.emergency?.autoAlertsEnabled !== false &&
    !emergency.alertSentAt;

  if (shouldAutoAlert && event) {
    const label = CATEGORY_LABELS[emergency.category] ?? "Emergency";
    const actionRequired = CATEGORY_ACTION_REQUIRED[emergency.category] ?? CATEGORY_ACTION_REQUIRED.other;
    const message = `${actionRequired}`;

    const fanoutResult = await broadcastEmergencyAlert({
      event,
      emergency,
      title: `🚨 ${label} Reported`,
      message,
      data: { actionRequired },
    });

    emergency.status = "alert_sent";
    emergency.alertSentAt = now;
    emergency.alertRecipientCount = fanoutResult.recipientCount;
    emergency.notificationCount += 1;

    await writeAuditLog(emergency.eventId, {
      emergencyId: emergency._id,
      action: "alert_sent",
      metadata: { confidenceScore: result.score, ...fanoutResult },
    });
  }

  await emergency.save();

  return emergency;
};

const resolveEmergency = async ({ emergencyId, actorUserId, falsePositive = false, note = "" }) => {
  const emergency = await EventEmergency.findById(emergencyId);

  if (!emergency) {
    throw new ApiError(404, "Emergency not found");
  }

  const event = await loadEventOrThrow(emergency.eventId);
  await ensureCanManageEmergency(event, actorUserId);

  emergency.status = "resolved";
  emergency.isActive = false;
  emergency.resolvedAt = new Date();
  emergency.resolvedByUserId = actorUserId;
  emergency.falsePositive = Boolean(falsePositive);
  emergency.resolutionNote = note;
  await emergency.save();

  await writeAuditLog(emergency.eventId, {
    emergencyId: emergency._id,
    actorUserId,
    action: "resolved",
    metadata: { falsePositive: emergency.falsePositive, note },
  });

  return emergency;
};

const broadcastManualUpdate = async ({ emergencyId, actorUserId, message }) => {
  const emergency = await EventEmergency.findById(emergencyId);

  if (!emergency) {
    throw new ApiError(404, "Emergency not found");
  }

  const event = await loadEventOrThrow(emergency.eventId);
  await ensureCanManageEmergency(event, actorUserId);

  const label = CATEGORY_LABELS[emergency.category] ?? "Emergency";
  const fanoutResult = await broadcastEmergencyAlert({
    event,
    emergency,
    title: `${label} Update`,
    message,
    data: { manual: true },
  });

  emergency.notificationCount += 1;
  emergency.alertRecipientCount = Math.max(emergency.alertRecipientCount, fanoutResult.recipientCount);
  await emergency.save();

  await writeAuditLog(emergency.eventId, {
    emergencyId: emergency._id,
    actorUserId,
    action: "manual_broadcast",
    metadata: { message, ...fanoutResult },
  });

  return emergency;
};

const getActiveEmergencyForAttendee = async ({ eventId }) => {
  const emergency = await EventEmergency.findOne({ eventId, isActive: true });

  if (!emergency) {
    return null;
  }

  const label = CATEGORY_LABELS[emergency.category] ?? "Emergency";
  const actionRequired = CATEGORY_ACTION_REQUIRED[emergency.category] ?? CATEGORY_ACTION_REQUIRED.other;

  return {
    _id: emergency._id,
    eventId: emergency.eventId,
    category: emergency.category,
    label,
    actionRequired,
    status: emergency.status,
    alertSentAt: emergency.alertSentAt,
    createdAt: emergency.createdAt,
  };
};

const listEventEmergencies = async ({ eventId, actorUserId }) => {
  const event = await loadEventOrThrow(eventId);
  await ensureCanManageEmergency(event, actorUserId);

  return EventEmergency.find({ eventId }).sort({ createdAt: -1 });
};

const getEmergencyDetail = async ({ emergencyId, actorUserId }) => {
  const emergency = await EventEmergency.findById(emergencyId);

  if (!emergency) {
    throw new ApiError(404, "Emergency not found");
  }

  const event = await loadEventOrThrow(emergency.eventId);
  await ensureCanManageEmergency(event, actorUserId);

  const reports = await EmergencyReport.find({ emergencyId: emergency._id })
    .sort({ createdAt: -1 })
    .populate("attendeeUserId", "fullName email avatarUrl");

  return {
    emergency,
    reports,
    geofence: {
      latitude: event.latitude,
      longitude: event.longitude,
      radiusMeters: resolveEmergencyRadius(event),
    },
  };
};

const getEventEmergencyAnalytics = async ({ eventId, actorUserId }) => {
  const event = await loadEventOrThrow(eventId);
  await ensureCanManageEmergency(event, actorUserId);

  const emergencies = await EventEmergency.find({ eventId }).lean();
  const totalReports = emergencies.reduce((sum, item) => sum + (item.reportCount || 0), 0);

  const settled = emergencies.filter((item) => item.status === "resolved" || item.status === "archived");
  const falsePositives = settled.filter((item) => item.falsePositive);

  const alerted = emergencies.filter((item) => item.alertSentAt && item.detectedAt);
  const avgTimeToAlertMs = alerted.length
    ? alerted.reduce(
        (sum, item) => sum + (new Date(item.alertSentAt).getTime() - new Date(item.detectedAt).getTime()),
        0,
      ) / alerted.length
    : null;

  const responded = emergencies.filter((item) => item.resolvedAt && item.alertSentAt);
  const avgResponseTimeMs = responded.length
    ? responded.reduce(
        (sum, item) => sum + (new Date(item.resolvedAt).getTime() - new Date(item.alertSentAt).getTime()),
        0,
      ) / responded.length
    : null;

  const totalAlertRecipients = emergencies.reduce((sum, item) => sum + (item.alertRecipientCount || 0), 0);

  return {
    totalEmergencies: emergencies.length,
    totalReports,
    avgTimeToAlertMs,
    avgResponseTimeMs,
    totalAlertRecipients,
    falsePositiveRate: settled.length ? falsePositives.length / settled.length : null,
  };
};

const archiveStaleResolvedEmergencies = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_MS);
  const stale = await EventEmergency.find({ status: "resolved", resolvedAt: { $lte: cutoff } });

  for (const emergency of stale) {
    emergency.status = "archived";
    emergency.archivedAt = now;
    await emergency.save();
    await writeAuditLog(emergency.eventId, {
      emergencyId: emergency._id,
      action: "archived",
      metadata: {},
    });
  }

  return stale.length;
};

module.exports = {
  submitEmergencyReport,
  recomputeEmergencyConfidence,
  resolveEmergency,
  broadcastManualUpdate,
  getActiveEmergencyForAttendee,
  listEventEmergencies,
  getEmergencyDetail,
  getEventEmergencyAnalytics,
  archiveStaleResolvedEmergencies,
  CATEGORY_LABELS,
  CATEGORY_ACTION_REQUIRED,
};
