const { Schema, model } = require("mongoose");

const attendanceSessionSchema = new Schema(
  {
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
    status: {
      type: String,
      enum: ["checked-in", "checked-out"],
      required: true,
      default: "checked-in",
      index: true,
    },
    checkedInAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    checkedOutAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastSeenLatitude: {
      type: Number,
      default: null,
      min: -90,
      max: 90,
    },
    lastSeenLongitude: {
      type: Number,
      default: null,
      min: -180,
      max: 180,
    },
    lastSeenAccuracyMeters: {
      type: Number,
      default: null,
      min: 0,
      max: 10000,
    },
    lastSeenLocation: {
      type: String,
      trim: true,
      default: "",
      maxlength: 300,
    },
    lastSeenWithinGeofence: {
      type: Boolean,
      default: true,
      index: true,
    },
    consecutiveMisses: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    lastMonitorCheckAt: {
      type: Date,
      default: null,
      index: true,
    },
    autoCheckoutReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 240,
    },
  },
  {
    timestamps: true,
  },
);

attendanceSessionSchema.index(
  { workspaceId: 1, userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "checked-in" },
  },
);

const AttendanceSession = model("AttendanceSession", attendanceSessionSchema);

module.exports = AttendanceSession;
