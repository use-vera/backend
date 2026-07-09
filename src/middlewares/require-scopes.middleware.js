const ApiError = require("../utils/api-error");

const requireScopes =
  (...requiredScopes) =>
  (req, _res, next) => {
    const granted = req.apiAuth?.scopes || [];
    const missing = requiredScopes.filter((scope) => !granted.includes(scope));

    if (missing.length) {
      next(
        new ApiError(
          403,
          `Missing required scope(s): ${missing.join(", ")}`,
          { missing },
          "MISSING_SCOPE",
        ),
      );
      return;
    }

    next();
  };

module.exports = requireScopes;
