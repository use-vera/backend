const { Schema, model } = require("mongoose");

/**
 * One person waiting for a sold-out event.
 *
 *   waiting   → in the queue
 *   notified  → a spot opened and they were told; they have a while to buy
 *   purchased → they got a ticket
 *   expired   → told, but didn't buy in time; the next person gets a turn
 *   left      → took themselves off
 */
const eventWaitlistEntrySchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["waiting", "notified", "purchased", "expired", "left"],
      default: "waiting",
      index: true,
    },
    notifiedAt: { type: Date, default: null },
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

eventWaitlistEntrySchema.index({ eventId: 1, userId: 1 }, { unique: true });
eventWaitlistEntrySchema.index({ eventId: 1, status: 1, createdAt: 1 });

module.exports = model("EventWaitlistEntry", eventWaitlistEntrySchema);
