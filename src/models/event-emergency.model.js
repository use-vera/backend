const { Schema, model } = require("mongoose");

/**
 * The lifecycle entity for a suspected in-progress emergency at an event.
 * `isActive` mirrors `status` (true while monitoring/detected/alert_sent,
 * false once resolved/archived) purely to back the partial unique index
 * below, which enforces "at most one active emergency per event" at the
 * DB level rather than relying only on application-level check-then-create.
 */
const eventEmergencySchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
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
    status: {
      type: String,
      enum: ["monitoring", "detected", "alert_sent", "resolved", "archived"],
      default: "monitoring",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    confidenceLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    reportCount: {
      type: Number,
      default: 0,
    },
    uniqueReporterCount: {
      type: Number,
      default: 0,
    },
    reportsPerMinute: {
      type: Number,
      default: 0,
    },
    centroidLatitude: {
      type: Number,
      default: null,
    },
    centroidLongitude: {
      type: Number,
      default: null,
    },
    detectedAt: {
      type: Date,
      default: null,
    },
    alertSentAt: {
      type: Date,
      default: null,
    },
    alertRecipientCount: {
      type: Number,
      default: 0,
    },
    // Bumped on the initial auto-alert and on every manual broadcast —
    // never on a plain incoming report — this is what makes "update the
    // numbers, don't resend the alert" observable from the outside.
    notificationCount: {
      type: Number,
      default: 0,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    falsePositive: {
      type: Boolean,
      default: false,
    },
    resolutionNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

eventEmergencySchema.index(
  { eventId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
eventEmergencySchema.index({ eventId: 1, createdAt: -1 });

const EventEmergency = model("EventEmergency", eventEmergencySchema);

module.exports = EventEmergency;
