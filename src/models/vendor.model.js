const { Schema, model } = require("mongoose");
const { VENDOR_CATEGORIES } = require("../constants/vendor-categories");

/**
 * A vendor is a business that sells at events: food, drinks, merch.
 *
 * One per user, which is what makes "the vendor workspace" a place rather than
 * a selector. A user can be an attendee, an organizer and a vendor at once;
 * those are roles on the same account, not separate logins.
 */

/**
 * A vendor's own heading on their menu ("Mains", "Cold drinks").
 *
 * Embedded rather than its own collection: sections have no life apart from
 * the vendor that owns them, are read on every menu render, and are few.
 * Items point at one by id, so renaming a section never touches an item.
 */
const vendorSectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    /* Sections are ordered by the vendor, and that order is the order
       attendees scroll through. */
    position: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const vendorSchema = new Schema(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    /* The public page's address: /vendors/<slug>. Stable once issued, so a
       link an organizer saved keeps working after a rename. */
    slug: { type: String, required: true, unique: true, index: true },
    logoUrl: { type: String, default: "" },
    /* What they sell, from Vera's fixed list. This is what attendees filter
       by and organizers search on. */
    categories: {
      type: [{ type: String, enum: VENDOR_CATEGORIES }],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "Pick at least one thing you sell",
      },
    },
    city: { type: String, trim: true, maxlength: 80, default: "" },
    /* Orders reach the vendor in the app; this is for the organizer to reach
       a human before the event. Never shown to attendees. */
    contactPhone: { type: String, trim: true, maxlength: 32, default: "" },
    sections: { type: [vendorSectionSchema], default: [] },
    /**
     * Progressive KYC, mirroring the organizer payout tiers in
     * config/payout-tiers.js: a bank account is enough to start, a BVN lifts
     * the limit, a CAC number removes it.
     */
    verificationLevel: {
      type: String,
      enum: ["starter", "verified", "registered"],
      default: "starter",
      index: true,
    },
    /**
     * What a vendor submitted to move up a level, and where it got to.
     *
     * A BVN is never stored: it goes to the provider that checks it and what
     * comes back here is the answer plus the last four digits, which is all
     * anyone needs to recognise which number they used.
     */
    verification: {
      status: {
        type: String,
        enum: ["none", "pending", "verified", "rejected"],
        default: "none",
      },
      bvnLast4: { type: String, default: "" },
      cacNumber: { type: String, trim: true, default: "" },
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      reviewNote: { type: String, trim: true, maxlength: 300, default: "" },
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
    /* Denormalised from vendor ratings, which do not exist yet. Kept here so
       the fields that every listing needs are read in one query. */
    averageRating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },
    eventsWorkedCount: { type: Number, default: 0 },
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

/* Discovery: organizers browse by what a vendor sells and where they are. */
vendorSchema.index({ categories: 1, city: 1 });
vendorSchema.index({ businessName: "text" });

const Vendor = model("Vendor", vendorSchema);

module.exports = Vendor;
