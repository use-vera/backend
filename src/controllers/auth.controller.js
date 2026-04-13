const asyncHandler = require("../utils/async-handler");
const {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
} = require("../services/auth.service");
const { listUserWorkspaces } = require("../services/workspace.service");
const { syncUserSubscriptionState } = require("../services/subscription.service");

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
  login,
  refresh,
  logout,
  getCurrentSession,
};
