const ApiError = require("../utils/api-error");

const formatZodError = (error) =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

const createValidationMiddleware = (schema, source) => (req, _res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    next(
      new ApiError(400, "Validation error", {
        source,
        errors: formatZodError(result.error),
      }),
    );
    return;
  }

  req[source] = result.data;
  next();
};

const validateBody = (schema) => createValidationMiddleware(schema, "body");
const validateParams = (schema) => createValidationMiddleware(schema, "params");
const validateQuery = (schema) => createValidationMiddleware(schema, "query");

module.exports = {
  validateBody,
  validateParams,
  validateQuery,
};
