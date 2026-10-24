const { Schema, model } = require("mongoose");

/**
 * Something Vera keeps an eye on while the app is closed: a resale price
 * dropping under a line, or a host announcing their next event. When it
 * happens she tells the person, and holds the ticket for 10 minutes if they
 * asked her to. She never buys.
 */
const veraWatchSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["resale_price", "host_drop"], required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    organizerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    maxPriceNaira: { type: Number, min: 1, default: null },
    action: { type: String, enum: ["notify", "hold"], default: "notify" },
    /* The watch in the person's words: "Tell me if a Detty Fest resale drops under ₦20,000". */
    label: { type: String, default: "", maxlength: 200 },
    status: { type: String, enum: ["watching", "triggered", "stopped"], default: "watching" },
    /* Resale prices seen, per ticket, newest last; enough for a small chart. */
    prices: { type: [{ at: Date, priceNaira: Number, _id: false }], default: [] },
    listingsSeen: { type: Number, default: 0 },
    lastCheckedAt: { type: Date, default: null },
    triggeredAt: { type: Date, default: null },
    /* The event that set it off: the host's new one, or the event whose resale dropped. */
    triggerEventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    triggerPriceNaira: { type: Number, default: null },
    holdId: { type: Schema.Types.ObjectId, ref: "TicketHold", default: null },
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

veraWatchSchema.index({ status: 1, lastCheckedAt: 1 });
veraWatchSchema.index({ userId: 1, status: 1 });

module.exports = model("VeraWatch", veraWatchSchema);
