const { Schema, model } = require("mongoose");
const { VENDOR_CATEGORIES } = require("../constants/vendor-categories");

/**
 * One thing a vendor sells.
 *
 * Its own collection rather than an array on the vendor: a menu is read and
 * written far more often than the profile around it, items are paged and
 * filtered on their own, and an order line will point at one by id.
 *
 * Two different groupings, which are easy to confuse:
 *   category  - Vera's fixed list. How attendees filter and organizers search.
 *   sectionId - the vendor's own heading. How their menu is laid out.
 */
const vendorItemSchema = new Schema(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 400, default: "" },
    imageUrl: { type: String, default: "" },
    /* Whole naira, like ticketPriceNaira everywhere else in this codebase.
       Kobo never enters the model; Paystack amounts are derived at checkout. */
    priceNaira: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: VENDOR_CATEGORIES,
      required: true,
      index: true,
    },
    /* Null means the item sits under the menu's default heading, which is
       also where an item lands when its section is deleted. */
    sectionId: { type: Schema.Types.ObjectId, default: null },
    position: { type: Number, default: 0 },
    /**
     * Alcohol, and anything else an adult may buy and a minor may not.
     *
     * Set by the vendor per item rather than inferred from the category:
     * "drinks" covers both a beer and a Chapman, and guessing wrong in
     * either direction is a bad day for somebody.
     */
    ageRestricted: { type: Boolean, default: false },
    /* The "sold out" switch. Off hides the item from buyers immediately,
       without deleting anything the vendor typed. */
    available: { type: Boolean, default: true },
    /**
     * How many are left, or null for no limit.
     *
     * Deliberately a plain count on the item for now. Stock per event needs
     * the event booking that does not exist yet; when it does, that belongs
     * in the booking, not here.
     */
    stock: { type: Number, default: null, min: 0 },
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

/* The menu render: one vendor's items, in the vendor's own order. */
vendorItemSchema.index({ vendorId: 1, sectionId: 1, position: 1 });
/* What is actually on sale right now, for the attendee-facing list. */
vendorItemSchema.index({ vendorId: 1, available: 1 });

const VendorItem = model("VendorItem", vendorItemSchema);

module.exports = VendorItem;
