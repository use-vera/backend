const { Schema, model } = require("mongoose");

const attendanceLogSchema = new Schema(
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
    type: {
      type: String,
      enum: ["check-in", "check-out"],
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    method: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "GPS + Device Biometrics",
    },
    status: {
      type: String,
      enum: ["verified"],
      default: "verified",
      index: true,
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
    accuracyMeters: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
    },
    geofence: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    deviceHint: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "Mobile device",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  },
);

attendanceLogSchema.index({ workspaceId: 1, userId: 1, timestamp: -1 });
attendanceLogSchema.index({ workspaceId: 1, timestamp: -1 });

const AttendanceLog = model("AttendanceLog", attendanceLogSchema);

module.exports = AttendanceLog;
