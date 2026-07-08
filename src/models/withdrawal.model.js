const { Schema, model } = require("mongoose");

/**
 * Tracks a withdrawal through the async Paystack transfer lifecycle.
 * "reserved" means availableBalanceKobo has already been moved into the
 * wallet's reservedBalanceKobo (see withdrawal.service.js) — reservation
 * happens before the Paystack call, not after, to close the double-spend
 * race between concurrent withdrawal requests.
 */
const withdrawalSchema = new Schema(
  {
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    payoutAccountId: {
      type: Schema.Types.ObjectId,
      ref: "PayoutAccount",
      required: true,
    },
    amountKobo: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ["reserved", "processing", "completed", "failed", "reversed"],
      default: "reserved",
      index: true,
    },
    paystackTransferCode: {
      type: String,
      trim: true,
      default: "",
    },
    paystackReference: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
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

withdrawalSchema.index({ organizerUserId: 1, createdAt: -1 });

const Withdrawal = model("Withdrawal", withdrawalSchema);

module.exports = Withdrawal;
