const { Schema, model } = require("mongoose");

/**
 * Immutable financial ledger line. Never updated after creation except the
 * one guarded status transition (pending_settlement -> settled, performed
 * atomically in wallet-settlement.service.js) and never deleted.
 *
 * idempotencyKey is the real double-write guard (unique index), not just an
 * application-level check-before-insert — see wallet.service.js and
 * wallet-settlement.service.js for how it's derived per transaction type.
 */
const walletTransactionSchema = new Schema(
  {
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "OrganizerWallet",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "ticket_sale",
        "platform_fee",
        "refund",
        "chargeback",
        "settlement",
        "withdrawal",
        "withdrawal_reversal",
        "adjustment",
      ],
      required: true,
      index: true,
    },
    // Signed: credits to the organizer are positive, debits are negative.
    amountKobo: {
      type: Number,
      required: true,
    },
    bucket: {
      type: String,
      enum: ["pending", "available"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending_settlement", "settled", "reversed", "completed", "failed"],
      default: "completed",
      index: true,
    },
    // Only set on ticket_sale/platform_fee lines that start pending_settlement.
    settlementEligibleAt: {
      type: Date,
      default: null,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      default: null,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      default: null,
      index: true,
    },
    paymentAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentAttempt",
      default: null,
    },
    withdrawalId: {
      type: Schema.Types.ObjectId,
      ref: "Withdrawal",
      default: null,
    },
    // Links settlement -> originating ticket_sale, refund -> originating
    // ticket_sale, withdrawal_reversal -> the withdrawal it reverses.
    sourceTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
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

walletTransactionSchema.index({ organizerUserId: 1, createdAt: -1 });
walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, status: 1, settlementEligibleAt: 1 });
walletTransactionSchema.index({ ticketId: 1, type: 1 });

const WalletTransaction = model("WalletTransaction", walletTransactionSchema);

module.exports = WalletTransaction;
