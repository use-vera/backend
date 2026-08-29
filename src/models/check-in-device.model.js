const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * A door lane. One per scanning device, so an admission can be attributed to
 * a physical position ("Door 2") and a lost phone can be revoked without
 * touching the operator's own login.
 */
const checkInDeviceSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    // Registration token, stored hashed. It authorises roster refresh and
    // sync for this device alone.
    tokenHash: {
      type: String,
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

checkInDeviceSchema.index({ eventId: 1, revokedAt: 1 });

module.exports = mongoose.model("CheckInDevice", checkInDeviceSchema);
