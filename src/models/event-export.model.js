const { Schema, model } = require("mongoose");

const eventExportSchema = new Schema(
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
    kind: {
      type: String,
      enum: ["tickets", "attendees", "finance", "campaigns"],
      default: "tickets",
      index: true,
    },
    format: {
      type: String,
      enum: ["csv", "json"],
      default: "csv",
    },
    status: {
      type: String,
      enum: ["ready", "failed"],
      default: "ready",
      index: true,
    },
    fileName: {
      type: String,
      trim: true,
      maxlength: 280,
      default: "",
    },
    mimeType: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "text/csv",
    },
    rowCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    dateRangeFrom: {
      type: Date,
      default: null,
    },
    dateRangeTo: {
      type: Date,
      default: null,
    },
    columns: {
      type: [String],
      default: [],
    },
    previewRows: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    summary: {
      type: Schema.Types.Mixed,
      default: {},
    },
    content: {
      type: String,
      default: "",
    },
    errorMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
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

eventExportSchema.index({ eventId: 1, createdAt: -1 });

const EventExport = model("EventExport", eventExportSchema);

module.exports = EventExport;
