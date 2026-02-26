const { Schema, model } = require("mongoose");

const eventPostSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    authorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["photo", "update"],
      default: "photo",
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 800,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    likesCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    commentsCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    visibility: {
      type: String,
      enum: ["public", "ticket-holders"],
      default: "public",
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

eventPostSchema.index({ eventId: 1, createdAt: -1 });
eventPostSchema.index({ organizerUserId: 1, createdAt: -1 });

const EventPost = model("EventPost", eventPostSchema);

module.exports = EventPost;
