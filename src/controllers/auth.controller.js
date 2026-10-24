const asyncHandler = require("../utils/async-handler");
const ApiError = require("../utils/api-error");
const {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  requestSignInCode,
  verifySignInCode,
  completeSignUp,
} = require("../services/auth.service");
const { listUserWorkspaces } = require("../services/workspace.service");
const { syncUserSubscriptionState } = require("../services/subscription.service");
const { signRealtimeToken } = require("../utils/jwt");
const {
  listSessions,
  revokeSession,
  revokeOtherSessions,
} = require("../services/session.service");

/* Who is signing in, for the "where you're signed in" list. The device
   part comes from the client and is only ever shown back to the owner. */
const contextOf = (req) => ({
  device: req.body?.device,
  ip: req.ip,
  userAgent: req.get("user-agent") || "",
});

const register = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await registerUser(payload, contextOf(req));

  res.status(201).json({
    success: true,
    message: "Registration successful",
    data: result,
  });
});

const login = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await loginUser(payload, contextOf(req));

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: result,
  });
});

const requestCode = asyncHandler(async (req, res) => {
  const result = await requestSignInCode({ email: req.body.email });

  res.status(200).json({
    success: true,
    message: "Code sent",
    data: result,
  });
});

const verifyCode = asyncHandler(async (req, res) => {
  const result = await verifySignInCode(req.body, contextOf(req));

  res.status(200).json({
    success: true,
    message:
      result.status === "signed_in" ? "Signed in" : "Email verified",
    data: result,
  });
});

const completeSignUpController = asyncHandler(async (req, res) => {
  const result = await completeSignUp(req.body, contextOf(req));

  res.status(201).json({
    success: true,
    message: "Account created",
    data: result,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await refreshSession(payload, contextOf(req));

  res.status(200).json({
    success: true,
    message: "Session refreshed",
    data: result,
  });
});

const logout = asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const result = await logoutUser(payload);

  res.status(200).json({
    success: true,
    message: "Session closed",
    data: result,
  });
});

/**
 * Mints a handshake token for a client that cannot read its own bearer
 * token, which today means the web app: its token lives in an httpOnly
 * cookie the browser is not allowed to see.
 */
const createRealtimeToken = asyncHandler(async (req, res) => {
  const token = signRealtimeToken({
    userId: req.auth.userId,
    ...(req.auth.sessionId ? { sid: req.auth.sessionId } : {}),
  });

  res.status(200).json({
    success: true,
    message: "Realtime token issued",
    data: { token },
  });
});

const getCurrentSession = asyncHandler(async (req, res) => {
  await syncUserSubscriptionState({ user: req.user });
  const workspaces = await listUserWorkspaces(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Session fetched",
    data: {
      user: req.user,
      workspaces,
    },
  });
});

const listSessionsController = asyncHandler(async (req, res) => {
  const result = await listSessions({ userId: req.auth.userId, currentSessionId: req.auth.sessionId });
  res.status(200).json({ success: true, message: "Sessions fetched", data: result });
});

const revokeSessionController = asyncHandler(async (req, res) => {
  const result = await revokeSession({ userId: req.auth.userId, sessionId: req.params.sessionId });
  res.status(200).json({ success: true, message: "Device signed out", data: result });
});

/* Everywhere but here. Needs a session-bound token: without one we can't
   tell which device "here" is, and would sign this one out too. */
const revokeOtherSessionsController = asyncHandler(async (req, res) => {
  if (!req.auth.sessionId) {
    throw new ApiError(409, "Sign in again on this device first", null, "SESSION_REQUIRED");
  }
  const result = await revokeOtherSessions({ userId: req.auth.userId, exceptSessionId: req.auth.sessionId });
  res.status(200).json({ success: true, message: "Signed out everywhere else", data: result });
});

module.exports = {
  listSessionsController,
  revokeSessionController,
  revokeOtherSessionsController,
  requestCode,
  verifyCode,
  completeSignUp: completeSignUpController,
  register,
  createRealtimeToken,
  login,
  refresh,
  logout,
  getCurrentSession,
};
