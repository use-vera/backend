const { Schema, model } = require("mongoose");

/**
 * Friends going to one event together. The owner started it and is usually
 * the one buying for the group; everyone else is invited, then joins or
 * declines. The group has its own chat (a group DirectConversation).
 */
const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["owner", "invited", "joined", "declined", "left"], required: true },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    invitedAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    /* "Remind" is once a day, so a forgotten invite isn't a stream of pings. */
    lastRemindedAt: { type: Date, default: null },
  },
  { _id: false },
);

const togetherGroupSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [memberSchema], default: [] },
    conversationId: { type: Schema.Types.ObjectId, ref: "DirectConversation", default: null },
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

/* One group per person per event: starting again opens the one you have. */
togetherGroupSchema.index({ eventId: 1, ownerUserId: 1 }, { unique: true });
togetherGroupSchema.index({ "members.userId": 1, eventId: 1 });

module.exports = model("TogetherGroup", togetherGroupSchema);
