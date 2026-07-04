const { Schema, model } = require("mongoose");

const followSchema = new Schema(
  {
    followerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    followingUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
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

followSchema.index(
  { followerUserId: 1, followingUserId: 1 },
  { unique: true },
);
followSchema.index({ followingUserId: 1, createdAt: -1 });

const Follow = model("Follow", followSchema);

module.exports = Follow;
