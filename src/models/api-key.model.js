const { Schema, model } = require("mongoose");
const { ALL_SCOPES } = require("../config/api-scopes");

/**
 * Workspace-scoped Developer Platform credentials. secretKeyHash is the only
 * persisted form of the secret key — select:false so it's never loaded by
 * default, mirroring User.passwordHash. The raw secret is shown to the
 * caller exactly once, at creation time, and never again.
 */
const apiKeySchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ["live", "test"],
      required: true,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    publishableKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    secretKeyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false,
    },
    secretKeyLastFour: {
      type: String,
      required: true,
      maxlength: 4,
    },
    scopes: {
      type: [String],
      default: [],
      validate: {
        validator: (values) => values.every((value) => ALL_SCOPES.includes(value)),
        message: "Unknown API scope",
      },
    },
    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        delete ret.secretKeyHash;
        return ret;
      },
    },
  },
);

apiKeySchema.index({ workspaceId: 1, status: 1 });

const ApiKey = model("ApiKey", apiKeySchema);

module.exports = ApiKey;
