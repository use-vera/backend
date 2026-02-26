const { Schema, model } = require("mongoose");

const eventRatingSchema = new Schema(
  {
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      trim: true,
      maxlength: 600,
      default: "",
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

eventRatingSchema.index({ eventId: 1, userId: 1 }, { unique: true });
eventRatingSchema.index({ eventId: 1, createdAt: -1 });

const EventRating = model("EventRating", eventRatingSchema);

module.exports = EventRating;
