const { Schema, model } = require("mongoose");

/**
 * One paid resale, and the seller's payout for it.
 *
 * Created only from a verified Paystack payment, one per payment reference,
 * so a payment seen twice (verify and webhook) records one sale. Vera takes
 * no fee: the seller is owed the full amount.
 *
 * Life of a sale:
 *   held             → waiting for the event to end + the payout delay
 *   awaiting_account → due, but the seller has no payout account yet
 *   processing       → transfer sent to Paystack, waiting for its webhook
 *   paid             → Paystack confirmed the transfer
 *   failed           → the transfer failed; the payout job retries it
 *   cancelled        → the event was cancelled; the buyer is refunded and
 *                      the seller gets back what they paid for the ticket
 */
const resaleSaleSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    sourceTicketId: { type: Schema.Types.ObjectId, ref: "EventTicket", required: true, index: true },
    /* The ticket the buyer now holds (the same one on a full sale). */
    ticketId: { type: Schema.Types.ObjectId, ref: "EventTicket", required: true },
    sellerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    buyerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    quantity: { type: Number, required: true, min: 1 },
    amountKobo: { type: Number, required: true, min: 1 },
    resalePaymentReference: { type: String, required: true, unique: true, trim: true },
    paymentAttemptId: { type: Schema.Types.ObjectId, ref: "PaymentAttempt", default: null },
    /* What the seller paid for the tickets they sold, and on which payment,
       so a cancelled event can give it back to them. */
    sellerPaymentReference: { type: String, default: "", trim: true },
    sellerPaidKobo: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["held", "awaiting_account", "processing", "paid", "failed", "cancelled"],
      default: "held",
      index: true,
    },
    releaseAt: { type: Date, required: true, index: true },
    transferReference: { type: String, default: "", trim: true },
    transferCode: { type: String, default: "", trim: true },
    transferAttempts: { type: Number, default: 0 },
    transferStartedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    /* Bank details at the time of payout, for the seller's own record. */
    paidToBankName: { type: String, default: "" },
    paidToAccountLast4: { type: String, default: "" },
    cancelledAt: { type: Date, default: null },
    sellerRefund: {
      status: { type: String, enum: ["none", "refunded", "failed"], default: "none" },
      method: { type: String, default: "" },
      at: { type: Date, default: null },
      error: { type: String, default: "" },
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

resaleSaleSchema.index({ status: 1, releaseAt: 1 });
resaleSaleSchema.index({ sellerUserId: 1, createdAt: -1 });
resaleSaleSchema.index({ transferReference: 1 });

module.exports = model("ResaleSale", resaleSaleSchema);
