const ApiError = require("../utils/api-error");
const {
  verifyAccessToken,
  REALTIME_SCOPE,
  SIGNUP_SCOPE,
} = require("../utils/jwt");
const User = require("../models/user.model");
const { isSessionActive, touchSession } = require("../services/session.service");

const authMiddleware = async (req, _res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication token is required");
    }

    const token = authorization.slice(7);
    const payload = verifyAccessToken(token);

    /* Neither a socket handshake token nor a sign-up token is an API
       credential. */
    if (payload?.scope === REALTIME_SCOPE || payload?.scope === SIGNUP_SCOPE) {
      throw new ApiError(401, "Authentication token is required");
    }

    /* A token tied to a device stops working the moment that device is
       signed out, not when the token would have expired. Tokens from
       before sessions existed carry no sid and run out on their own. */
    const [user, sessionActive] = await Promise.all([
      User.findById(payload.userId),
      payload.sid ? isSessionActive(payload.sid) : Promise.resolve(true),
    ]);

    if (!sessionActive) {
      throw new ApiError(401, "This device was signed out", null, "SESSION_REVOKED");
    }

    if (!user || user.deletedAt) {
      throw new ApiError(401, "User for this token no longer exists");
    }

    if (payload.sid) void touchSession(payload.sid);

    req.auth = {
      userId: String(user._id),
      sessionId: payload.sid ? String(payload.sid) : null,
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
