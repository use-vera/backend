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
    unreadCountByUser: {
      type: Map,
      of: Number,
      default: {},
    },
    lastReadAtByUser: {
      type: Map,
      of: Date,
      default: {},
    },
    lastNudgeAtByUser: {
      type: Map,
      of: Date,
      default: {},
    },
    lastNudgedCountByUser: {
      type: Map,
      of: Number,
      default: {},
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
  const objectIdRegex = /^[a-fA-F0-9]{24}$/;
  const normalizeParticipant = (value) => {
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "object" && value._id) {
      return String(value._id).trim();
    }

    return String(value).trim();
  };

  schema.pre("validate", function normalize(next) {
    if (!Array.isArray(this.participants)) {
      next();
      return;
    }

    this.participants = [...new Set(
      this.participants
        .map((item) => normalizeParticipant(item))
        .map((item) => (objectIdRegex.test(item) ? item : ""))
        .filter(Boolean),
    )].sort();

    if (!this.directKey && this.participants.length === 2) {
      this.directKey = `${this.participants[0]}:${this.participants[1]}`;
    }

    next();
  });
}

const DirectConversation = model("DirectConversation", directConversationSchema);

module.exports = DirectConversation;
