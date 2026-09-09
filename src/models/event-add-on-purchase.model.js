const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * One add-on a buyer holds against one ticket.
 *
 * These are separate rows rather than line items inside EventTicket because
 * each is redeemed on its own: a ticket carries a single `status`, and
 * checking someone in at the gate must not spend their dinner. The row also
 * outlives edits to the event, which is why the name, price and redemption
 * rules are snapshotted here rather than read back off the add-on.
 */
const eventAddOnPurchaseSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    // Add-ons are never sold on their own, so every row has a ticket.
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
      index: true,
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
    // The sub-document id on Event.addOns. Kept for stock counting; every
    // field a buyer or a door needs is snapshotted below.
    addOnId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    variantName: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "",
    },
    redemption: {
      type: String,
      enum: ["door", "desk", "none"],
      default: "door",
    },
    location: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    unitPriceNaira: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
      default: 1,
    },
    // Partial collection is real: two shirts bought, one picked up.
    redeemedQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "redeemed", "cancelled", "refunded"],
      default: "pending",
      index: true,
    },
    // Mirrors the ticket's own batch id so a checkout can be reconciled whole.
    purchaseBatchId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    paymentReference: {
      type: String,
      trim: true,
      default: "",
    },
    // What Vera took and what the organizer is owed for this line, computed
    // at checkout by the same fee rules tickets use.
    pricingBreakdown: {
      type: Schema.Types.Mixed,
      default: null,
    },
    redeemedAt: {
      type: Date,
      default: null,
    },
    redeemedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Stock counting: everything reserved for one add-on, optionally by variant.
eventAddOnPurchaseSchema.index({ eventId: 1, addOnId: 1, status: 1 });
// The door and the desk both open on "what does this ticket still hold".
eventAddOnPurchaseSchema.index({ ticketId: 1, status: 1 });
// The organizer's fulfilment list, grouped by where it is handed over.
eventAddOnPurchaseSchema.index({ eventId: 1, redemption: 1, status: 1 });

module.exports = mongoose.model("EventAddOnPurchase", eventAddOnPurchaseSchema);
