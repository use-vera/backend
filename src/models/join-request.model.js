const { Schema, model } = require("mongoose");

const joinRequestSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
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
      trim: true,
      maxlength: 500,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

joinRequestSchema.index(
  { workspaceId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

const JoinRequest = model("JoinRequest", joinRequestSchema);

module.exports = JoinRequest;
