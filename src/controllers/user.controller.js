const asyncHandler = require("../utils/async-handler");
const {
  getUserProfile,
  getUserSubscription,
  updateUserProfile,
  updatePassword,
  getUserPreferences,
  updateUserPreferences,
  getUserAttendanceReport,
  checkHandleAvailability,
  completeOnboarding,
} = require("../services/user.service");
const { listSuggestedHosts } = require("../services/follow.service");

const checkHandleController = asyncHandler(async (req, res) => {
  const result = await checkHandleAvailability({
    userId: req.auth.userId,
    handle: req.query.handle,
  });

  res.status(200).json({
    success: true,
    message: "Handle checked",
    data: result,
  });
});

const completeOnboardingController = asyncHandler(async (req, res) => {
  const profile = await completeOnboarding(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Onboarding complete",
    data: profile,
  });
});

const listSuggestedHostsController = asyncHandler(async (req, res) => {
  const result = await listSuggestedHosts({
    userId: req.auth.userId,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Suggested hosts fetched",
    data: result,
  });
});

const getMyProfileController = asyncHandler(async (req, res) => {
  const profile = await getUserProfile(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Profile fetched",
    data: profile,
  });
});

const getMySubscriptionController = asyncHandler(async (req, res) => {
  const subscription = await getUserSubscription(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Subscription fetched",
    data: subscription,
  });
});

const updateMyProfileController = asyncHandler(async (req, res) => {
  const profile = await updateUserProfile(req.auth.userId, req.body);

  res.status(200).json({
    success: true,
    message: "Profile updated",
    data: profile,
  });
});

const updateMyPasswordController = asyncHandler(async (req, res) => {
  const result = await updatePassword({
    userId: req.auth.userId,
    ...req.body,
  });

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

const getMyPreferencesController = asyncHandler(async (req, res) => {
  const preferences = await getUserPreferences(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Preferences fetched",
    data: preferences,
  });
});

const updateMyPreferencesController = asyncHandler(async (req, res) => {
  const preferences = await updateUserPreferences(req.auth.userId, req.body);

  res.status(200).json({
    success: true,
    message: "Preferences updated",
    data: preferences,
  });
});

const getMyAttendanceReportController = asyncHandler(async (req, res) => {
  const report = await getUserAttendanceReport({
    userId: req.auth.userId,
    workspaceRef: req.query.workspaceId,
    period: req.query.period,
    from: req.query.from,
    to: req.query.to,
  });

  res.status(200).json({
    success: true,
    message: "Attendance report fetched",
    data: report,
  });
});

module.exports = {
  getMyProfileController,
  getMySubscriptionController,
  updateMyProfileController,
  updateMyPasswordController,
  getMyPreferencesController,
  updateMyPreferencesController,
  getMyAttendanceReportController,
  checkHandleController,
  completeOnboardingController,
  listSuggestedHostsController,
};
