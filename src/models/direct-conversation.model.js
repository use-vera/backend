const { Schema, model } = require("mongoose");

const directConversationSchema = new Schema(
  {
    directKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    participants: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      ],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: "Direct conversation must have exactly two participants",
      },
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    lastMessageText: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: "",
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastMessageSenderUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

directConversationSchema.index({ participants: 1, updatedAt: -1 });

autoNormalizeParticipants(directConversationSchema);

function autoNormalizeParticipants(schema) {
  schema.pre("validate", function normalize(next) {
    if (!Array.isArray(this.participants)) {
      next();
      return;
    }

    this.participants = this.participants
      .map((item) => String(item))
      .sort()
      .map((item) => item);

    if (!this.directKey && this.participants.length === 2) {
      this.directKey = `${this.participants[0]}:${this.participants[1]}`;
    }

    next();
  });
}

const DirectConversation = model("DirectConversation", directConversationSchema);

module.exports = DirectConversation;
