const { Schema, model } = require("mongoose");

const MAX_GROUP_PARTICIPANTS = 12;

const directConversationSchema = new Schema(
  {
    directKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    /* "group" is a Together group's chat: its key is `together:<groupId>`,
       it is named after the event, and it can hold more than two people. */
    kind: {
      type: String,
      enum: ["direct", "group"],
      default: "direct",
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },
    togetherGroupId: {
      type: Schema.Types.ObjectId,
      ref: "TogetherGroup",
      default: null,
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
        validator: function validateParticipants(value) {
          if (!Array.isArray(value)) return false;
          return this.kind === "group" ? value.length >= 1 && value.length <= MAX_GROUP_PARTICIPANTS : value.length === 2;
        },
        message: "A direct conversation has exactly two participants; a group has up to twelve",
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

  schema.pre("validate", function normalize() {
    if (!Array.isArray(this.participants)) {
      return;
    }

    this.participants = [...new Set(
      this.participants
        .map((item) => normalizeParticipant(item))
        .map((item) => (objectIdRegex.test(item) ? item : ""))
        .filter(Boolean),
    )].sort();

    if (!this.directKey && this.kind !== "group" && this.participants.length === 2) {
      this.directKey = `${this.participants[0]}:${this.participants[1]}`;
    }
  });
}

const DirectConversation = model("DirectConversation", directConversationSchema);

module.exports = DirectConversation;
module.exports.MAX_GROUP_PARTICIPANTS = MAX_GROUP_PARTICIPANTS;
