const { Schema, model } = require("mongoose");

/**
 * One person blocking another. Either direction keeps them apart: no
 * following, no messages, no sending tickets, and the blocked person can't
 * open the blocker's profile. The blocked person isn't told.
 */
const userBlockSchema = new Schema(
  {
    blockerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blockedUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
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

userBlockSchema.index({ blockerUserId: 1, blockedUserId: 1 }, { unique: true });

module.exports = model("UserBlock", userBlockSchema);
