const { Schema, model } = require("mongoose");

const eventTicketSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      min: 1,
      max: 20,
      default: 1,
    },
    unitPriceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalPriceNaira: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["pending", "paid", "cancelled", "used", "expired"],
      default: "pending",
      index: true,
    },
    paymentProvider: {
      type: String,
      enum: ["none", "paystack"],
      default: "none",
    },
    paymentReference: {
      type: String,
      trim: true,
      default: null,
      unique: true,
      sparse: true,
    },
    paymentAuthorizationUrl: {
      type: String,
      trim: true,
      default: "",
    },
    paymentAccessCode: {
      type: String,
      trim: true,
      default: "",
    },
    paymentMetadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    attendeeName: {
      type: String,
      trim: true,
      maxlength: 140,
      default: "",
    },
    attendeeEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    ticketCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    barcodeValue: {
      type: String,
      required: true,
      trim: true,
      maxlength: 400,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    usedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

eventTicketSchema.index({ buyerUserId: 1, createdAt: -1 });
eventTicketSchema.index({ eventId: 1, status: 1 });
eventTicketSchema.index({ organizerUserId: 1, createdAt: -1 });

const EventTicket = model("EventTicket", eventTicketSchema);

module.exports = EventTicket;
