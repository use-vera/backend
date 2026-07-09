const ApiRequestLog = require("../models/api-request-log.model");

/**
 * Minimal security/audit request log for /v1 — fire-and-forget, never
 * blocks or fails the actual response. Must run after apiKeyAuthMiddleware
 * so req.apiAuth is populated.
 */
const apiRequestLogMiddleware = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    ApiRequestLog.create({
      workspaceId: req.apiAuth?.workspaceId || null,
      apiKeyId: req.apiAuth?.apiKeyId || null,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      ipAddress: req.ip || "",
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
      durationMs: Date.now() - startedAt,
    }).catch(() => {});
  });

  next();
};

module.exports = apiRequestLogMiddleware;
