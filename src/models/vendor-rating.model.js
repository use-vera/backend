const { Schema, model } = require("mongoose");

/**
 * One buyer's rating of one order they actually collected.
 *
 * Tied to the order rather than the vendor, which is what keeps the number
 * honest: you can only rate food you were handed, and only once.
 */
const vendorRatingSchema = new Schema(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "VendorOrder",
      required: true,
      unique: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 300, default: "" },
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

const VendorRating = model("VendorRating", vendorRatingSchema);

module.exports = VendorRating;
