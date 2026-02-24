const ApiError = require("../utils/api-error");

const notFoundMiddleware = (_req, _res, next) => {
  next(new ApiError(404, "Route not found"));
};

const errorMiddleware = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
    return;
  }

  if (error.name === "ValidationError") {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      details: error.errors,
    });
    return;
  }

  if (error.code === 11000) {
    res.status(409).json({
      success: false,
      message: "Duplicate value conflict",
      details: error.keyValue,
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

module.exports = {
  notFoundMiddleware,
  errorMiddleware,
};
