const { Schema, model } = require("mongoose");

/**
 * One order placed with one vendor at one event.
 *
 * The money is held, not sent: nothing reaches the vendor's wallet until the
 * order is collected. That is the whole safety net behind letting vendors
 * sign up with nothing but a bank account, so `collected` is the only status
 * that releases funds (vendor-order.service.js).
 *
 * Every line is snapshotted. An order is a record of what was agreed, so
 * editing a menu item later must not rewrite what somebody already bought.
 */
const vendorOrderLineSchema = new Schema(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "VendorItem",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    unitPriceNaira: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotalNaira: { type: Number, required: true, min: 0 },
    /* Snapshotted like the price: what was sold, and whether it needed an
       adult, is a fact about the order rather than about the item today. */
    ageRestricted: { type: Boolean, default: false },
  },
  { _id: false },
);

const vendorOrderPricingSchema = new Schema(
  {
    subtotalNaira: { type: Number, required: true, min: 0 },
    serviceFeeNaira: { type: Number, default: 0, min: 0 },
    totalChargedNaira: { type: Number, required: true, min: 0 },
    veraFeeNaira: { type: Number, default: 0, min: 0 },
    vendorNetNaira: { type: Number, default: 0, min: 0 },
    platformFeePercent: { type: Number, default: 0 },
  },
  { _id: false },
);

const vendorOrderSchema = new Schema(
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
    /* The vendor's owner, copied here so crediting a wallet at collection
       does not need a second lookup on the hot path. */
    vendorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /* The booking this order belongs to. Its terms decide the organizer's
       share, and they are snapshotted into `pricing` at order time. */
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "EventVendor",
      required: true,
    },
    /**
     * The four digits the buyer shows at the stall. Short because it is read
     * aloud across a counter; safe because it only ever identifies an order
     * that is already paid for, is scoped to one vendor, and is checked by
     * the vendor holding the food.
     */
    pickupCode: { type: String, required: true },
    lines: { type: [vendorOrderLineSchema], required: true },
    note: { type: String, trim: true, maxlength: 200, default: "" },
    pricing: { type: vendorOrderPricingSchema, required: true },
    status: {
      type: String,
      enum: [
        "pending_payment",
        "paid",
        "preparing",
        "ready",
        "collected",
        "cancelled",
        "refunded",
      ],
      required: true,
      index: true,
    },
    paymentProvider: {
      type: String,
      enum: ["paystack", "none"],
      default: "none",
    },
    paymentReference: { type: String, default: "" },
    paymentAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentAttempt",
      default: null,
    },
    paidAt: { type: Date, default: null },
    preparingAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    collectedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, maxlength: 300, default: "" },
    refundReference: { type: String, default: "" },
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

/* The vendor's queue: one event's live orders, oldest first. */
vendorOrderSchema.index({ vendorId: 1, eventId: 1, status: 1, createdAt: 1 });
/* The buyer's own orders. */
vendorOrderSchema.index({ buyerUserId: 1, createdAt: -1 });
/**
 * A pickup code only has to be unique among the orders that could still be
 * collected, which is what makes four digits enough. The partial filter is
 * what keeps last week's A51 from blocking tonight's.
 */
vendorOrderSchema.index(
  { vendorId: 1, eventId: 1, pickupCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending_payment", "paid", "preparing", "ready"] },
    },
  },
);

const VendorOrder = model("VendorOrder", vendorOrderSchema);

module.exports = VendorOrder;
