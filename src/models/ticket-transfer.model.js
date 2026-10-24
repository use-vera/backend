const { Schema, model } = require("mongoose");

/**
 * A ticket being sent to someone. The ticket stays the sender's (and keeps
 * working for them) until the recipient accepts; then it moves, with a fresh
 * code, and the sender's copy stops working.
 *
 * The recipient is either a Vera account (toUserId) or an email address for
 * someone not on Vera yet (toEmail). Only that person can accept: the claim
 * link alone is not enough. The link's token is stored hashed.
 */
const ticketTransferSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "EventTicket", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    toEmail: { type: String, default: "", lowercase: true, trim: true, index: true },
    note: { type: String, default: "", trim: true, maxlength: 200 },
    tokenHash: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "cancelled"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        delete ret.tokenHash;
        return ret;
      },
    },
  },
);

/* At most one live send per ticket. */
ticketTransferSchema.index(
  { ticketId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_transfer_per_ticket" },
);

module.exports = model("TicketTransfer", ticketTransferSchema);
