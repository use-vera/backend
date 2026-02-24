const { Schema, model } = require("mongoose");

const workspaceInviteSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    invitedEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["member", "admin"],
      default: "member",
      index: true,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    invitedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "revoked"],
      default: "pending",
      index: true,
    },
    respondedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    respondedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

workspaceInviteSchema.index(
  { workspaceId: 1, invitedEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

const WorkspaceInvite = model("WorkspaceInvite", workspaceInviteSchema);

module.exports = WorkspaceInvite;
