const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * One use of a promo code by one buyer, on one checkout.
 *
 * Separate rows rather than a counter on the code itself: a counter cannot
 * answer "has this person already used it", cannot be released when a
 * checkout is abandoned, and cannot be incremented safely by two checkouts
 * at once. Counting rows can do all three.
 *
 * The row is written "reserved" when checkout starts and only becomes
 * "confirmed" when the payment settles — a code is spent when money moves,
 * not when it is typed.
 */
const promoCodeRedemptionSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    // The sub-document id on Event.promoCodes. The code text is snapshotted
    // below so a renamed or deleted code still reads correctly here.
    promoCodeId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 24,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
      index: true,
    },
    // Ties the row to the checkout that created it, so settling or
    // abandoning that checkout can find it without knowing the ticket ids.
    purchaseBatchId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    appliesTo: {
      type: String,
      enum: ["ticket", "addons"],
      required: true,
    },
    // What this use actually took off, in naira. Snapshotted because the
    // code's percentage can change after the fact and this is the number
    // the organizer's payout was reduced by.
    discountNaira: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["reserved", "confirmed", "released"],
      default: "reserved",
      index: true,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
    releaseReason: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
  },
  { timestamps: true },
);

// Usage counting: every live use of one code.
promoCodeRedemptionSchema.index({ promoCodeId: 1, status: 1 });
// The per-attendee limit, and the "you already used this" check.
promoCodeRedemptionSchema.index({ promoCodeId: 1, buyerUserId: 1, status: 1 });
// One checkout can only ever hold one row per code.
promoCodeRedemptionSchema.index(
  { purchaseBatchId: 1, promoCodeId: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "PromoCodeRedemption",
  promoCodeRedemptionSchema,
);
