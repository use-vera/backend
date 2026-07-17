const { Schema, model } = require("mongoose");

/**
 * Audit trail for every emergency-related action (report submitted,
 * lifecycle transitions, manual broadcasts, resolutions). Unlike
 * GeofenceOverrideLog this has no TTL — safety-incident records are kept
 * indefinitely, matching the "never delete reports" rule for the reports
 * themselves.
 */
const emergencyAuditLogSchema = new Schema(
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
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    action: {
      type: String,
      enum: [
        "report_submitted",
        "emergency_detected",
        "alert_sent",
        "manual_broadcast",
        "resolved",
        "archived",
      ],
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false },
);

emergencyAuditLogSchema.index({ eventId: 1, createdAt: -1 });

const EmergencyAuditLog = model("EmergencyAuditLog", emergencyAuditLogSchema);

module.exports = EmergencyAuditLog;
