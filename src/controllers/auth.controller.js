const asyncHandler = require("../utils/async-handler");
const {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
} = require("../services/auth.service");
const { listUserWorkspaces } = require("../services/workspace.service");
const { syncUserSubscriptionState } = require("../services/subscription.service");
const { signRealtimeToken } = require("../utils/jwt");

const register = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await registerUser(payload);

  res.status(201).json({
    success: true,
    message: "Registration successful",
    data: result,
  });
});

const login = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await loginUser(payload);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: result,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const payload = req.body;
  const result = await refreshSession(payload);

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
  const token = signRealtimeToken({ userId: req.auth.userId });

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

module.exports = {
  register,
  createRealtimeToken,
  login,
  refresh,
  logout,
  getCurrentSession,
};
