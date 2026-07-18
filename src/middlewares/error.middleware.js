const ApiError = require("../utils/api-error");

const notFoundMiddleware = (_req, _res, next) => {
  next(new ApiError(404, "Route not found"));
};

// Morgan only ever prints "METHOD path STATUS duration - length" — the
// actual reason a request failed (message/code/details, or a stack trace
// for a genuine bug) was previously only ever sent in the HTTP response
// body, never written to stdout/stderr, so it never showed up in Render's
// (or any other host's) log stream. Every branch below now logs enough to
// diagnose the failure from logs alone.
const logError = ({ req, statusCode, message, code, details, stack }) => {
  const summary = `[${statusCode}] ${req.method} ${req.originalUrl} — ${message}${code ? ` (${code})` : ""}`;

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(summary, { userId: req.auth?.userId, details, stack });
    return;
  }

  // eslint-disable-next-line no-console
  console.warn(summary, { userId: req.auth?.userId, details });
};

const errorMiddleware = (error, req, res, _next) => {
  if (error instanceof ApiError) {
    logError({
      req,
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      details: error.details,
    });

    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details || null,
      code: error.code || null,
    });
    return;
  }

  if (error.name === "ValidationError") {
    logError({
      req,
      statusCode: 400,
      message: "Validation failed",
      details: error.errors,
    });

    res.status(400).json({
      success: false,
      message: "Validation failed",
      details: error.errors,
    });
    return;
  }

  if (error.code === 11000) {
    logError({
      req,
      statusCode: 409,
      message: "Duplicate value conflict",
      details: error.keyValue,
    });

    res.status(409).json({
      success: false,
      message: "Duplicate value conflict",
      details: error.keyValue,
    });
    return;
  }

  logError({
    req,
    statusCode: 500,
    message: error instanceof Error ? error.message : "Internal server error",
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

module.exports = {
  notFoundMiddleware,
  errorMiddleware,
};
