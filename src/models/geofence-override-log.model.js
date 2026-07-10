const { Schema, model } = require("mongoose");

/**
 * Audit trail for check-ins an organizer confirmed anyway despite being
 * outside the event's geofence. Minimal by design — one row per override,
 * self-prunes via the TTL index below.
 */
const geofenceOverrideLogSchema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    checkedInByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    distanceMeters: {
      type: Number,
      required: true,
    },
    allowedRadiusMeters: {
      type: Number,
      required: true,
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

geofenceOverrideLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 365 },
);
geofenceOverrideLogSchema.index({ eventId: 1, createdAt: -1 });

const GeofenceOverrideLog = model(
  "GeofenceOverrideLog",
  geofenceOverrideLogSchema,
);

module.exports = GeofenceOverrideLog;
