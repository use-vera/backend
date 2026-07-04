const { Schema, model } = require("mongoose");

const eventViewSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
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

eventViewSchema.index({ userId: 1, eventId: 1 }, { unique: true });
eventViewSchema.index({ eventId: 1, userId: 1 });

const EventView = model("EventView", eventViewSchema);

module.exports = EventView;
