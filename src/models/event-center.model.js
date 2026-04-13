const { Schema, model } = require("mongoose");

const normalizeCenterName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const eventCenterSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 300,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 300,
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
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        default: [0, 0],
      },
    },
    usageCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    successfulEventsCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

eventCenterSchema.index({ location: "2dsphere" });
eventCenterSchema.index({ normalizedName: 1, verified: -1, successfulEventsCount: -1 });

eventCenterSchema.pre("validate", function preValidate() {
  this.normalizedName = normalizeCenterName(this.name);
  this.location = {
    type: "Point",
    coordinates: [Number(this.longitude || 0), Number(this.latitude || 0)],
  };
});

const EventCenter = model("EventCenter", eventCenterSchema);

module.exports = EventCenter;
