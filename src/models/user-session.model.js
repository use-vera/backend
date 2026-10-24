const { Schema, model } = require("mongoose");

/**
 * One signed-in device. Each sign-in gets its own session and its own
 * refresh token, so signing in on a second phone no longer signs out the
 * first, and any one of them can be signed out on its own.
 *
 * Access tokens carry the session id (`sid`); the auth middleware refuses
 * a token whose session has been revoked, so "sign out" takes effect at
 * once rather than when the token would have expired.
 */
const userSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /* SHA-256 of the current refresh token. Rotated on every refresh. */
    refreshTokenHash: { type: String, required: true, select: false },
    deviceName: { type: String, trim: true, maxlength: 80, default: "" },
    platform: { type: String, enum: ["ios", "android", "web", "unknown"], default: "unknown" },
    appVersion: { type: String, trim: true, maxlength: 32, default: "" },
    userAgent: { type: String, trim: true, maxlength: 300, default: "" },
    lastIp: { type: String, trim: true, maxlength: 64, default: "", select: false },
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ["signed_out", "signed_out_elsewhere", "email_changed", "account_deleted", null],
      default: null,
    },
    /* When the refresh token runs out. Mongo removes the row a day later. */
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        delete ret.refreshTokenHash;
        delete ret.lastIp;
        return ret;
      },
    },
  },
);

userSessionSchema.index({ userId: 1, revokedAt: 1, lastUsedAt: -1 });
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = model("UserSession", userSessionSchema);
