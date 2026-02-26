const { Schema, model } = require("mongoose");

const directMessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "DirectConversation",
      required: true,
      index: true,
    },
    senderUserId: {
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

directMessageSchema.index({ conversationId: 1, createdAt: -1 });

const DirectMessage = model("DirectMessage", directMessageSchema);

module.exports = DirectMessage;
