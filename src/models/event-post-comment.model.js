const { Schema, model } = require("mongoose");

const eventPostCommentSchema = new Schema(
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
    comment: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 800,
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

eventPostCommentSchema.index({ postId: 1, createdAt: -1 });
eventPostCommentSchema.index({ eventId: 1, createdAt: -1 });

const EventPostComment = model("EventPostComment", eventPostCommentSchema);

module.exports = EventPostComment;
