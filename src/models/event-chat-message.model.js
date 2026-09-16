const { Schema, model } = require("mongoose");

const eventChatMessageSchema = new Schema(
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
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1200,
    },
    messageType: {
      type: String,
      enum: ["text", "ticket", "event"],
      default: "text",
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    /* Stored rather than re-parsed. A display name can contain spaces, so
       "@Adaeze Okonkwo" cannot be told apart from an "@" followed by two
       ordinary words once the text is all that is left. The names are the
       server's, not the sender's, so a message cannot claim a mention it
       does not have in order to style arbitrary text. */
    mentions: {
      everyone: { type: Boolean, default: false },
      users: {
        type: [
          {
            _id: false,
            userId: { type: Schema.Types.ObjectId, ref: "User" },
            name: { type: String, trim: true, maxlength: 120 },
          },
        ],
        default: [],
      },
    },
    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: "EventChatMessage",
      default: null,
      index: true,
    },
    forwardedFromMessageId: {
      type: Schema.Types.ObjectId,
      ref: "EventChatMessage",
      default: null,
      index: true,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
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

eventChatMessageSchema.index({ eventId: 1, createdAt: -1 });

const EventChatMessage = model("EventChatMessage", eventChatMessageSchema);

module.exports = EventChatMessage;
