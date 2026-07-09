const ApiError = require("../utils/api-error");

// Fallback machine-readable code when a thrown error doesn't set one
// explicitly (error.code) — keeps every /v1 error response shaped the same
// even for errors that predate this codes convention.
const STATUS_CODE_FALLBACK = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * Stripe-style error envelope for the /v1 developer API:
 * {success:false, error:{code, message}} — deliberately parallel to, and
 * never touching, the internal API's {success, message, details} shape in
 * error.middleware.js. Mounted as the trailing middleware inside
 * v1.routes.js so it only ever catches errors from that sub-router.
 */
const v1ErrorMiddleware = (error, _req, res, _next) => {
  let statusCode = 500;

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
  } else if (error.name === "ValidationError") {
    statusCode = 400;
  } else if (error.code === 11000) {
    statusCode = 409;
  }

  const code = error.code && typeof error.code === "string"
    ? error.code
    : STATUS_CODE_FALLBACK[statusCode] || "INTERNAL_ERROR";
  const message =
    error instanceof ApiError
      ? error.message
      : statusCode === 500
        ? "Internal server error"
        : error.message;

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
    },
  });
};

module.exports = v1ErrorMiddleware;
