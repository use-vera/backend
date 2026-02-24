const { Schema, model } = require("mongoose");

const recurringEventAttendanceSchema = new Schema(
  {
    recurringEventId: {
      type: Schema.Types.ObjectId,
      ref: "RecurringEvent",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["present", "absent"],
      default: "absent",
      index: true,
    },
    firstEnteredAt: {
      type: Date,
      default: null,
    },
    lastExitedAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    lastLatitude: {
      type: Number,
      default: null,
      min: -90,
      max: 90,
    },
    lastLongitude: {
      type: Number,
      default: null,
      min: -180,
      max: 180,
    },
    lastDistanceMeters: {
      type: Number,
      default: null,
      min: 0,
      max: 200000,
    },
  },
  {
    timestamps: true,
  },
);

recurringEventAttendanceSchema.index(
  { recurringEventId: 1, userId: 1, dateKey: 1 },
  { unique: true },
);

const RecurringEventAttendance = model(
  "RecurringEventAttendance",
  recurringEventAttendanceSchema,
);

module.exports = RecurringEventAttendance;
