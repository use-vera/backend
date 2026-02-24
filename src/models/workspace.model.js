const { Schema, model } = require("mongoose");

const geofenceSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    latitude: {
      type: Number,
      default: 0,
    },
    longitude: {
      type: Number,
      default: 0,
    },
    radiusMeters: {
      type: Number,
      default: 150,
      min: 10,
      max: 5000,
    },
  },
  { _id: false },
);

const presencePolicySchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    intervalMinutes: {
      type: Number,
      min: 10,
      max: 720,
      default: 60,
    },
    maxConsecutiveMisses: {
      type: Number,
      min: 1,
      max: 12,
      default: 2,
    },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    geofence: {
      type: geofenceSchema,
      default: () => ({
        name: "",
        address: "",
        latitude: 0,
        longitude: 0,
        radiusMeters: 150,
      }),
    },
    presencePolicy: {
      type: presencePolicySchema,
      default: () => ({
        enabled: true,
        intervalMinutes: 60,
        maxConsecutiveMisses: 2,
      }),
    },
  },
  {
    timestamps: true,
  },
);

const Workspace = model("Workspace", workspaceSchema);

module.exports = Workspace;
