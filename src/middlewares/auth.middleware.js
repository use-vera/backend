const ApiError = require("../utils/api-error");
const { verifyAccessToken } = require("../utils/jwt");
const User = require("../models/user.model");

const authMiddleware = async (req, _res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication token is required");
    }

    const token = authorization.slice(7);
    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.userId);

    if (!user) {
      throw new ApiError(401, "User for this token no longer exists");
    }

    req.auth = {
      userId: String(user._id),
      tokenPayload: payload,
    };
    req.user = user;

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      next(new ApiError(401, "Invalid or expired token"));
      return;
    }

    next(error);
  }
};

module.exports = authMiddleware;
