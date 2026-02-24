const { Schema, model } = require("mongoose");

const membershipSchema = new Schema(
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
    role: {
      type: String,
      enum: ["owner", "admin", "member"],
      default: "member",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "invited", "pending", "rejected"],
      default: "active",
      index: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const Membership = model("Membership", membershipSchema);

module.exports = Membership;
