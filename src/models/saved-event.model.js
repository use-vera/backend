const { Schema, model } = require("mongoose");

/** An event someone saved to come back to. One row per person per event. */
const savedEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
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

savedEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
savedEventSchema.index({ userId: 1, createdAt: -1 });

module.exports = model("SavedEvent", savedEventSchema);
