const { Schema, model } = require("mongoose");

const paymentAttemptSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
      index: true,
    },
    kind: {
      type: String,
      enum: ["ticket_purchase", "ticket_resale_purchase"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["initialized", "success", "failed", "abandoned", "expired"],
      default: "initialized",
      index: true,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      default: null,
      index: true,
    },
    resaleSourceTicketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      default: null,
      index: true,
    },
    acceptedBidId: {
      type: Schema.Types.ObjectId,
      ref: "TicketResaleBid",
      default: null,
      index: true,
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    amountKobo: {
      type: Number,
      min: 1,
      required: true,
    },
    callbackUrl: {
      type: String,
      trim: true,
      default: "",
    },
    authorizationUrl: {
      type: String,
      trim: true,
      default: "",
    },
    accessCode: {
      type: String,
      trim: true,
      default: "",
    },
    paystackInitializePayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    paystackVerifyPayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    fulfilledAt: {
      type: Date,
      default: null,
    },
    fulfillmentStatus: {
      type: String,
      enum: ["pending", "done", "failed"],
      default: "pending",
      index: true,
    },
    fulfillmentTicketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      default: "",
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

paymentAttemptSchema.index({ buyerUserId: 1, createdAt: -1 });
paymentAttemptSchema.index({ eventId: 1, createdAt: -1 });
paymentAttemptSchema.index({ ticketId: 1, kind: 1 });
paymentAttemptSchema.index({ resaleSourceTicketId: 1, kind: 1 });

module.exports = model("PaymentAttempt", paymentAttemptSchema);
