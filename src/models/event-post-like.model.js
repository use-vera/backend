const { Schema, model } = require("mongoose");

const eventPostLikeSchema = new Schema(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: "EventPost",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    userId: {
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

eventPostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
eventPostLikeSchema.index({ eventId: 1, createdAt: -1 });

const EventPostLike = model("EventPostLike", eventPostLikeSchema);

module.exports = EventPostLike;
