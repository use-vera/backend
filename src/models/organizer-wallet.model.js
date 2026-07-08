const { Schema, model } = require("mongoose");

/**
 * One wallet per organizer. Balances here are the source of truth and are
 * only ever mutated via $inc alongside a WalletTransaction insert (see
 * wallet.service.js) — never recomputed from EventTicket records.
 */
const organizerWalletSchema = new Schema(
  {
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    pendingBalanceKobo: {
      type: Number,
      default: 0,
    },
    availableBalanceKobo: {
      type: Number,
      default: 0,
    },
    reservedBalanceKobo: {
      type: Number,
      default: 0,
    },
    owingBalanceKobo: {
      type: Number,
      default: 0,
    },
    lifetimeGrossSalesKobo: {
      type: Number,
      default: 0,
    },
    lifetimePlatformFeesKobo: {
      type: Number,
      default: 0,
    },
    lifetimeWithdrawnKobo: {
      type: Number,
      default: 0,
    },
    lifetimeRefundedKobo: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    version: {
      type: Number,
      default: 0,
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

const OrganizerWallet = model("OrganizerWallet", organizerWalletSchema);

module.exports = OrganizerWallet;
