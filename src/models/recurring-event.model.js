const { Schema, model } = require("mongoose");

const geofenceOverrideSchema = new Schema(
  {
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    radiusMeters: { type: Number, min: 10, max: 5000, default: null },
  },
  { _id: false },
);

const recurringEventSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "daily",
      index: true,
    },
    interval: {
      type: Number,
      min: 1,
      max: 30,
      default: 1,
    },
    daysOfWeek: {
      type: [Number],
      default: [],
    },
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: null,
    },
    startTime: {
      type: String,
      required: true,
      trim: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    endTime: {
      type: String,
      required: true,
      trim: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    timezone: {
      type: String,
      trim: true,
      default: "Africa/Lagos",
    },
    geofenceOverride: {
      type: geofenceOverrideSchema,
      default: () => ({
        latitude: null,
        longitude: null,
        radiusMeters: null,
      }),
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

recurringEventSchema.index({ workspaceId: 1, enabled: 1, frequency: 1 });

const RecurringEvent = model("RecurringEvent", recurringEventSchema);

module.exports = RecurringEvent;
