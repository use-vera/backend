const { Schema, model } = require("mongoose");

/**
 * One vendor's place at one event: the invitation, the application, and the
 * deal they agreed.
 *
 * The terms are copied onto this row rather than read from the event, for the
 * same reason an add-on purchase snapshots its price: an organizer editing
 * their default terms next week must not silently change what a vendor already
 * accepted.
 *
 * Lifecycle, which only ever moves forward:
 *   invited   -> confirmed | declined   (the vendor answers)
 *   applied   -> confirmed | rejected   (the organizer answers)
 *   confirmed -> cancelled              (either side pulls out)
 */
const eventVendorTermsSchema = new Schema(
  {
    stallFeeNaira: { type: Number, default: 0, min: 0 },
    stallLabel: { type: String, trim: true, maxlength: 80, default: "" },
    setupFrom: { type: Date, default: null },
  },
  { _id: false },
);

const eventVendorSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["invited", "applied", "confirmed", "declined", "rejected", "cancelled"],
      required: true,
      index: true,
    },
    /* Which side opened the conversation. It decides who may answer. */
    origin: {
      type: String,
      enum: ["invite", "application"],
      required: true,
    },
    terms: {
      type: eventVendorTermsSchema,
      default: () => ({}),
    },
    invitedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    message: { type: String, trim: true, maxlength: 400, default: "" },
    /* Why a vendor said no, in their words. Shown to the organizer. */
    responseNote: { type: String, trim: true, maxlength: 400, default: "" },
    respondedAt: { type: Date, default: null },
    /**
     * Event-night state, set by the vendor from their orders screen.
     *
     * Switching off stops new orders without touching the booking: a vendor
     * who has sold out for the night is still confirmed for the event.
     */
    acceptingOrders: { type: Boolean, default: true },
    /* The wait time shown to buyers, in minutes. Set by the vendor, never
       guessed by us; null means we show nothing rather than a number we made
       up. */
    prepMinutes: { type: Number, default: null, min: 0, max: 600 },
    /**
     * How many of an item the vendor brought to THIS event.
     *
     * A menu is reused across events, so "18 left" belongs to the night, not
     * to the item. An item with no entry here falls back to its own stock,
     * which is how a vendor who never bothers still gets sensible behaviour.
     */
    itemStock: {
      type: [
        new Schema(
          {
            itemId: {
              type: Schema.Types.ObjectId,
              ref: "VendorItem",
              required: true,
            },
            remaining: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /**
     * The stall fee is money between the organizer and the vendor, taken
     * through Vera. Until a payment settles this stays false, so a confirmed
     * stall and a paid stall are never confused.
     */
    stallFeePaid: { type: Boolean, default: false },
    stallFeePaymentReference: { type: String, default: "" },
    /**
     * When the hold on this spot runs out.
     *
     * Set the moment a fee becomes payable and cleared when it is paid. A
     * spot nobody has paid for is a spot the organizer could be selling, so
     * the deadline is real: past it, the booking is released.
     */
    stallFeeDueAt: { type: Date, default: null, index: true },
    stallFeeRefundedAt: { type: Date, default: null },
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

/* One row per vendor per event: an invite and an application for the same
   pair are the same conversation, not two. */
eventVendorSchema.index({ eventId: 1, vendorId: 1 }, { unique: true });
/* The organizer's tab, and the vendor's own list. */
eventVendorSchema.index({ eventId: 1, status: 1 });
eventVendorSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

const EventVendor = model("EventVendor", eventVendorSchema);

module.exports = EventVendor;
