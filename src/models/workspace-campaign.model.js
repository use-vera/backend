const { Schema, model } = require("mongoose");

const workspaceCampaignSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["in_app", "email", "sms"],
      default: "in_app",
      index: true,
    },
    audience: {
      type: String,
      enum: ["members", "attendees", "all"],
      default: "all",
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["sent", "partial", "failed"],
      default: "sent",
      index: true,
    },
    recipientsCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    deliveredCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    failedCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
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

workspaceCampaignSchema.index({ workspaceId: 1, createdAt: -1 });

const WorkspaceCampaign = model("WorkspaceCampaign", workspaceCampaignSchema);

module.exports = WorkspaceCampaign;
