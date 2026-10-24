const { Schema, model } = require("mongoose");

/**
 * Tickets set aside for one person for a few minutes. Holding isn't buying:
 * nothing is charged, and the hold simply stops counting once `expiresAt`
 * passes. A primary hold counts against the event's stock for everyone but
 * its holder; a resale hold stops anyone else buying that one listing.
 */
const ticketHoldSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["primary", "resale"], required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    ticketCategoryId: { type: Schema.Types.ObjectId, default: null },
    quantity: { type: Number, min: 1, max: 10, required: true },
    /* The listed ticket, for a resale hold. */
    resaleTicketId: { type: Schema.Types.ObjectId, ref: "EventTicket", default: null },
    source: { type: String, enum: ["vera", "watch", "plan"], default: "vera" },
    status: { type: String, enum: ["active", "converted", "released"], default: "active" },
    expiresAt: { type: Date, required: true },
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

ticketHoldSchema.index({ eventId: 1, status: 1, expiresAt: 1 });
ticketHoldSchema.index({ userId: 1, status: 1, expiresAt: 1 });
ticketHoldSchema.index({ resaleTicketId: 1, status: 1, expiresAt: 1 });

module.exports = model("TicketHold", ticketHoldSchema);
