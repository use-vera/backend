const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const asyncHandler = require("../utils/async-handler");

/**
 * isPlatformAdmin is `select: false` on User (never returned by normal
 * queries), so this re-fetches it explicitly rather than widening what
 * authMiddleware loads on every request for the sake of a couple of
 * admin-only wallet routes.
 */
const requireAdmin = asyncHandler(async (req, _res, next) => {
  const user = await User.findById(req.auth.userId).select("+isPlatformAdmin");

  if (!user?.isPlatformAdmin) {
    throw new ApiError(403, "Admin access is required for this action");
  }

  next();
});

module.exports = requireAdmin;
