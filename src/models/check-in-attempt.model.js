const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Every scan, not only the one that won.
 *
 * A ticket carries the single admission that took effect; this collection
 * carries the whole history, including duplicates, rejections and overrides.
 * It is what the reconciliation screen reads, and what makes an offline door
 * auditable after the fact. "admitted at Door 1 19:42, scanned again at
 * Door 3 19:44" cannot be reconstructed from the ticket alone.
 */
const checkInAttemptSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      default: null,
      index: true,
    },
    // Kept even when no ticket resolved, so a bogus scan is still evidence.
    scannedCode: {
      type: String,
      trim: true,
      maxlength: 600,
      default: "",
    },
    deviceId: {
      type: Schema.Types.ObjectId,
      ref: "CheckInDevice",
      default: null,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    result: {
      type: String,
      enum: [
        "admitted",
        "duplicate",
        "invalid",
        "wrong_event",
        "outside_window",
        "not_active",
        "payment_pending",
        "outside_geofence",
      ],
      required: true,
      index: true,
    },
    via: {
      type: String,
      enum: ["online", "offline"],
      default: "online",
    },
    // When the door scanned it, corrected for that device's clock offset.
    scannedAt: {
      type: Date,
      required: true,
    },
    // When the server heard about it. Equal to scannedAt on the online path;
    // the gap between them is the offline window.
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    overridden: {
      type: Boolean,
      default: false,
    },
    // Client-assigned sequence, unique per device. Makes a retried batch
    // idempotent without the client having to know what already landed.
    clientSeq: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true },
);

// The idempotency guarantee: one row per (device, clientSeq). Sparse so the
// online path, which has neither, is unaffected.
checkInAttemptSchema.index(
  { deviceId: 1, clientSeq: 1 },
  { unique: true, sparse: true },
);
checkInAttemptSchema.index({ eventId: 1, ticketId: 1, createdAt: -1 });

module.exports = mongoose.model("CheckInAttempt", checkInAttemptSchema);
