const { Schema, model } = require("mongoose");

const eventCampaignSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    channel: {
      type: String,
      enum: ["email", "sms"],
      default: "email",
      index: true,
    },
    audience: {
      type: String,
      enum: [
        "all_ticket_holders",
        "checked_in_attendees",
        "paid_not_checked_in",
        "presale_buyers",
        "ticket_category",
      ],
      default: "all_ticket_holders",
      index: true,
    },
    audienceTicketCategoryId: {
      type: Schema.Types.ObjectId,
      default: null,
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
      maxlength: 4000,
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "failed", "cancelled"],
      default: "draft",
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
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
    openedCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    clickedCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    lastError: {
      type: String,
      trim: true,
      maxlength: 600,
      default: "",
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

eventCampaignSchema.index({ eventId: 1, createdAt: -1 });
eventCampaignSchema.index({ status: 1, scheduledAt: 1 });

const EventCampaign = model("EventCampaign", eventCampaignSchema);

module.exports = EventCampaign;
