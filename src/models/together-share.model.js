const { Schema, model } = require("mongoose");

/**
 * One friend's share of one ticket the owner sent them from a Together group.
 *
 * The ticket travels through an ordinary TicketTransfer, so the friend still
 * accepts it the usual way. While that transfer is pending the share reads as
 * "sent"; once accepted they owe it. The amount is what the owner paid for
 * that ticket, fixed when it was sent, so a later price change moves nothing.
 */
const togetherShareSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "TogetherGroup", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    /* Who owes, and who they owe. */
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: "EventTicket", required: true },
    transferId: { type: Schema.Types.ObjectId, ref: "TicketTransfer", required: true },
    amountKobo: { type: Number, required: true, min: 0 },
    /*
     * open      - waiting on the transfer, then on payment
     * on_me     - the owner covered it; nothing is owed
     * paid      - paid back through Paystack, money in the owner's wallet
     * refunded  - paid, then returned because the event was cancelled
     * cancelled - the transfer was cancelled or expired, so nothing is owed
     */
    status: { type: String, enum: ["open", "on_me", "paid", "refunded", "cancelled"], default: "open", index: true },
    paymentReference: { type: String, default: "" },
    /* What the friend was charged, the Paystack fee on top of the share included. */
    chargedKobo: { type: Number, default: 0 },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    /* "Nudge" is once a day. */
    lastNudgedAt: { type: Date, default: null },
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

/* A ticket can only be owed for once at a time. */
togetherShareSchema.index(
  { ticketId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["open", "on_me", "paid"] } } },
);

module.exports = model("TogetherShare", togetherShareSchema);
