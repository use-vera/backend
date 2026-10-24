const { Schema, model } = require("mongoose");

/* A pick as it looked when Vera made it. A snapshot, so old replies still read right after the event changes. */
const veraPickSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    name: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    /* Whether it had started when Vera picked it. */
    status: { type: String, enum: ["upcoming", "live"], default: "upcoming" },
    place: { type: String, default: "" },
    priceFromNaira: { type: Number, default: 0 },
    isPaid: { type: Boolean, default: false },
    matchScore: { type: Number, default: null },
    why: { type: String, default: "" },
  },
  { _id: false },
);

/**
 * Something Vera offers to do, shown as a button under her reply. She never
 * does it herself: the person taps to confirm, and the app calls the hold or
 * watch endpoint directly.
 */
const veraActionSchema = new Schema(
  {
    type: { type: String, enum: ["hold", "watch_resale", "watch_host"], required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    eventName: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    ticketCategoryId: { type: Schema.Types.ObjectId, default: null },
    ticketCategoryName: { type: String, default: "" },
    maxPriceNaira: { type: Number, default: null },
    label: { type: String, default: "" },
  },
  { _id: false },
);

/** One line in someone's conversation with Vera. */
const veraMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, default: "", maxlength: 4000 },
    picks: { type: [veraPickSchema], default: [] },
    actions: { type: [veraActionSchema], default: [] },
    /* What Vera used for this reply: "Near you", "Dry till 11PM", "₦18,000 left". */
    inputs: { type: [String], default: [] },
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

veraMessageSchema.index({ userId: 1, createdAt: -1 });

module.exports = model("VeraMessage", veraMessageSchema);
