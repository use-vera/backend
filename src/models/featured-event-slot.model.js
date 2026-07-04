const { Schema, model } = require("mongoose");

const featuredEventSlotSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    paymentAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentAttempt",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending_payment", "active", "cancelled", "expired"],
      default: "pending_payment",
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

featuredEventSlotSchema.index({ date: 1, status: 1 });
featuredEventSlotSchema.index({ eventId: 1, date: 1 });

const FeaturedEventSlot = model("FeaturedEventSlot", featuredEventSlotSchema);

module.exports = FeaturedEventSlot;
