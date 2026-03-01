const { Schema, model } = require("mongoose");

const paymentEventLogSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
      index: true,
    },
    eventType: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    reference: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    paymentAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentAttempt",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["received", "processed", "ignored", "failed", "invalid_signature"],
      default: "received",
      index: true,
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    payload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    meta: {
      type: Schema.Types.Mixed,
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

paymentEventLogSchema.index({ provider: 1, createdAt: -1 });
paymentEventLogSchema.index({ reference: 1, createdAt: -1 });

module.exports = model("PaymentEventLog", paymentEventLogSchema);
