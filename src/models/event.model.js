const { Schema, model } = require("mongoose");

const recurrenceSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["none", "weekly", "monthly-day", "monthly-weekday"],
      default: "none",
    },
    interval: {
      type: Number,
      min: 1,
      max: 12,
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
    weekOfMonth: {
      type: Number,
      enum: [1, 2, 3, 4, -1],
      default: null,
    },
    weekday: {
      type: Number,
      min: 0,
      max: 6,
      default: null,
    },
    endsOn: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 140,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
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
    geofenceRadiusMeters: {
      type: Number,
      min: 20,
      max: 10000,
      default: 150,
    },
    startsAt: {
      type: Date,
      required: true,
      index: true,
    },
    endsAt: {
      type: Date,
      required: true,
    },
    timezone: {
      type: String,
      trim: true,
      default: "Africa/Lagos",
    },
    isPaid: {
      type: Boolean,
      default: false,
      index: true,
    },
    ticketPriceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    expectedTickets: {
      type: Number,
      required: true,
      min: 1,
      max: 200000,
    },
    recurrence: {
      type: recurrenceSchema,
      default: () => ({ type: "none", interval: 1, daysOfWeek: [] }),
    },
    status: {
      type: String,
      enum: ["draft", "published", "cancelled"],
      default: "published",
      index: true,
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

eventSchema.index({ status: 1, startsAt: 1, createdAt: -1 });
eventSchema.index({ organizerUserId: 1, createdAt: -1 });

const Event = model("Event", eventSchema);

module.exports = Event;
