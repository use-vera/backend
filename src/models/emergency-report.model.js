const { Schema, model } = require("mongoose");

/**
 * A single attendee's emergency report. Reports are never deleted — this
 * is a safety record. A resubmission within the configured cooldown window
 * updates the attendee's existing report in place (see emergency.service.js)
 * rather than creating a new row, so `createdAt` stays fixed at first
 * submission (used for rate/spike detection) while `updatedAt` moves
 * forward on every resubmission (used for recency-decay weighting).
 */
const emergencyReportSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    emergencyId: {
      type: Schema.Types.ObjectId,
      ref: "EventEmergency",
      default: null,
      index: true,
    },
    attendeeUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
    },
    category: {
      type: String,
      enum: [
        "fire",
        "medical",
        "security_threat",
        "structural_collapse",
        "crowd_crush",
        "violence",
        "weather",
        "other",
      ],
      required: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    gpsAccuracy: {
      type: Number,
      default: null,
    },
    deviceId: {
      type: String,
      trim: true,
      default: "",
    },
    // Reserved for future use — no upload flow in this pass.
    mediaUrls: {
      type: [String],
      default: [],
    },
    // Per-category severity snapshot taken at write time so past scoring
    // stays reproducible even if these weights are tuned later.
    confidenceWeight: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true },
);

emergencyReportSchema.index({ eventId: 1, createdAt: -1 });
emergencyReportSchema.index({ eventId: 1, attendeeUserId: 1, createdAt: -1 });

const EmergencyReport = model("EmergencyReport", emergencyReportSchema);

module.exports = EmergencyReport;
