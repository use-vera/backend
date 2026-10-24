const { Schema, model } = require("mongoose");

/**
 * One pending sign-in code per email address.
 *
 * Only a hash of the code is stored. A new request replaces the previous
 * code rather than adding to it, so there is never more than one code that
 * works for an inbox. Mongo removes the row on its own once it expires.
 */
const emailOtpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    /* Wrong guesses against the current code. Reset when a new code is sent. */
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastSentAt: {
      type: Date,
      required: true,
    },
    /* Sends inside the current hour, for the per-inbox hourly cap. */
    sendWindowStartedAt: {
      type: Date,
      required: true,
    },
    sendsInWindow: {
      type: Number,
      default: 1,
      min: 0,
    },
  },
  { timestamps: true },
);

/* Kept a day past expiry so the hourly send cap still has its counters
   when someone asks again right after a code lapses. */
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

const EmailOtp = model("EmailOtp", emailOtpSchema);

module.exports = EmailOtp;
