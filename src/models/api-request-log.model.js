const { Schema, model } = require("mongoose");

/**
 * Minimal security/audit trail for /v1 requests (request logging, IP
 * logging, audit logs) — deliberately NOT the full usage-analytics
 * dashboard (request counts, response-time percentiles, rate-limit usage),
 * which is a deferred Developer Portal feature. Rows self-prune via the TTL
 * index below so this can never silently grow into that.
 */
const apiRequestLogSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      index: true,
    },
    apiKeyId: {
      type: Schema.Types.ObjectId,
      ref: "ApiKey",
      index: true,
    },
    method: {
      type: String,
      required: true,
    },
    path: {
      type: String,
      required: true,
      maxlength: 200,
    },
    statusCode: {
      type: Number,
      required: true,
    },
    ipAddress: {
      type: String,
      default: "",
      maxlength: 64,
    },
    userAgent: {
      type: String,
      default: "",
      maxlength: 300,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

apiRequestLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
apiRequestLogSchema.index({ workspaceId: 1, createdAt: -1 });

const ApiRequestLog = model("ApiRequestLog", apiRequestLogSchema);

module.exports = ApiRequestLog;
