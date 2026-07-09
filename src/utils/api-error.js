class ApiError extends Error {
  constructor(statusCode, message, details, code = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
    // Machine-readable error code for the /v1 developer API's
    // {success:false, error:{code, message}} envelope. Optional and unused
    // by the internal API's error middleware — existing callers that don't
    // pass it are unaffected.
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

module.exports = ApiError;
