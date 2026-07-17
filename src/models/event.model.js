const { Schema, model } = require("mongoose");
const { resolveCountryFromCoordinates } = require("../constants/country-bounding-boxes");

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

const pricingSchema = new Schema(
  {
    dynamicEnabled: {
      type: Boolean,
      default: false,
    },
    minPriceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
    maxPriceNaira: {
      type: Number,
      min: 0,
      default: null,
    },
    demandSensitivity: {
      type: Number,
      min: 0.1,
      max: 3,
      default: 1,
    },
    discountFloorRatio: {
      type: Number,
      min: 0.4,
      max: 1,
      default: 0.8,
    },
    surgeCapRatio: {
      type: Number,
      min: 1,
      max: 3,
      default: 1.6,
    },
  },
  { _id: false },
);

const resaleSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    allowBids: {
      type: Boolean,
      default: true,
    },
    maxMarkupPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 25,
    },
    bidWindowHours: {
      type: Number,
      min: 1,
      max: 72,
      default: 12,
    },
  },
  { _id: false },
);

const salesSchema = new Schema(
  {
    startsAt: {
      type: Date,
      default: null,
    },
    presaleEnabled: {
      type: Boolean,
      default: false,
    },
    presaleStartsAt: {
      type: Date,
      default: null,
    },
    presaleEndsAt: {
      type: Date,
      default: null,
    },
    presaleQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    presalePriceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
);

const emergencySchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    autoAlertsEnabled: {
      type: Boolean,
      default: true,
    },
    confidenceThreshold: {
      type: Number,
      min: 40,
      max: 100,
      default: 70,
    },
    reportCooldownSeconds: {
      type: Number,
      min: 15,
      max: 600,
      default: 60,
    },
    // null inherits the event's own geofenceRadiusMeters.
    geofenceRadiusMeters: {
      type: Number,
      min: 20,
      max: 10000,
      default: null,
    },
    sensitivity: {
      type: Number,
      min: 0.5,
      max: 2,
      default: 1,
    },
  },
  { _id: false },
);

const ticketCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 60,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 200000,
    },
    priceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: true,
  },
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
    eventCenterId: {
      type: Schema.Types.ObjectId,
      ref: "EventCenter",
      default: null,
      index: true,
    },
    // Discovery taxonomy (Music/Sports/Comedy/...) — unrelated to
    // ticketCategories below, which is a pricing-tier concept.
    categoryIds: {
      type: [Schema.Types.ObjectId],
      ref: "Category",
      default: [],
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
    state: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
      index: true,
    },
    country: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
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
    geofenceRadiusMeters: {
      type: Number,
      min: 20,
      max: 10000,
      default: 150,
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
    platformFeePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 5,
    },
    feeMode: {
      type: String,
      enum: ["absorbed_by_organizer", "passed_to_attendee"],
      default: "absorbed_by_organizer",
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
    ticketCategories: {
      type: [ticketCategorySchema],
      default: [],
    },
    recurrence: {
      type: recurrenceSchema,
      default: () => ({ type: "none", interval: 1, daysOfWeek: [] }),
    },
    pricing: {
      type: pricingSchema,
      default: () => ({
        dynamicEnabled: false,
        minPriceNaira: 0,
        maxPriceNaira: null,
        demandSensitivity: 1,
        discountFloorRatio: 0.8,
        surgeCapRatio: 1.6,
      }),
    },
    resale: {
      type: resaleSchema,
      default: () => ({
        enabled: true,
        allowBids: true,
        maxMarkupPercent: 25,
        bidWindowHours: 12,
      }),
    },
    sales: {
      type: salesSchema,
      default: () => ({
        startsAt: null,
        presaleEnabled: false,
        presaleStartsAt: null,
        presaleEndsAt: null,
        presaleQuantity: 0,
        presalePriceNaira: 0,
      }),
    },
    status: {
      type: String,
      enum: ["draft", "published", "cancelled"],
      default: "published",
      index: true,
    },
    emergency: {
      type: emergencySchema,
      default: () => ({
        enabled: true,
        autoAlertsEnabled: true,
        confidenceThreshold: 70,
        reportCooldownSeconds: 60,
        geofenceRadiusMeters: null,
        sensitivity: 1,
      }),
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
eventSchema.index({ location: "2dsphere" });

// Kept in sync with latitude/longitude so geo queries ($geoWithin) have a
// GeoJSON field to run against — latitude/longitude stay the source of
// truth and are never removed, this is purely a derived mirror. `country`
// is derived the same way, via a bounding-box lookup, so it never drifts
// from the event's real coordinates and is never accepted as client input.
eventSchema.pre("validate", function preValidate() {
  this.location = {
    type: "Point",
    coordinates: [Number(this.longitude || 0), Number(this.latitude || 0)],
  };
  this.country = resolveCountryFromCoordinates(this.latitude, this.longitude);
});

const Event = model("Event", eventSchema);

module.exports = Event;
