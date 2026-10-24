const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  handleCheckQuerySchema,
  suggestedHostsQuerySchema,
  updateProfileSchema,
  updatePasswordSchema,
  updatePreferencesSchema,
  attendanceReportQuerySchema,
  handleParamsSchema,
  recapQuerySchema,
  userIdParamsSchema,
  emailChangeRequestSchema,
  emailChangeConfirmSchema,
  deleteAccountSchema,
  searchPeopleQuerySchema,
} = require("../validations/user.validation");
const {
  requestEmailChangeController,
  confirmEmailChangeController,
  cancelEmailChangeController,
  blockUserController,
  unblockUserController,
  listBlockedUsersController,
  getDeletionCheckController,
  requestDeletionCodeController,
  deleteMyAccountController,
} = require("../controllers/account-security.controller");
const { rateLimit } = require("../middlewares/rate-limit.middleware");
const {
  getPublicProfileController,
  getPublicProfileByIdController,
  getMyRecapController,
  searchPeopleController,
} = require("../controllers/profile.controller");
const {
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
} = require("../controllers/user.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/me", getMyProfileController);
router.get(
  "/handles/check",
  validateQuery(handleCheckQuerySchema),
  checkHandleController,
);
router.get(
  "/by-handle/:handle",
  validateParams(handleParamsSchema),
  getPublicProfileController,
);
router.get(
  "/by-id/:userId",
  validateParams(userIdParamsSchema),
  getPublicProfileByIdController,
);
router.get("/me/recap", validateQuery(recapQuerySchema), getMyRecapController);
router.get("/search", validateQuery(searchPeopleQuerySchema), searchPeopleController);

/* Per account, on top of the per-inbox limits the codes already have. */
const emailChangeLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyFn: (req) => `email-change:${req.auth?.userId || req.ip}`,
});
router.post(
  "/me/email/change",
  emailChangeLimit,
  validateBody(emailChangeRequestSchema),
  requestEmailChangeController,
);
router.post(
  "/me/email/confirm",
  emailChangeLimit,
  validateBody(emailChangeConfirmSchema),
  confirmEmailChangeController,
);
router.delete("/me/email/change", cancelEmailChangeController);
router.get("/me/blocks", listBlockedUsersController);
router.get("/me/deletion-check", getDeletionCheckController);
router.post("/me/delete/code", emailChangeLimit, requestDeletionCodeController);
router.post("/me/delete", emailChangeLimit, validateBody(deleteAccountSchema), deleteMyAccountController);
router.post("/:userId/block", validateParams(userIdParamsSchema), blockUserController);
router.delete("/:userId/block", validateParams(userIdParamsSchema), unblockUserController);
router.post("/me/onboarding/complete", completeOnboardingController);
router.get(
  "/me/suggested-hosts",
  validateQuery(suggestedHostsQuerySchema),
  listSuggestedHostsController,
);
router.get("/me/subscription", getMySubscriptionController);
router.patch("/me", validateBody(updateProfileSchema), updateMyProfileController);
router.get("/me/preferences", getMyPreferencesController);
router.patch(
  "/me/preferences",
  validateBody(updatePreferencesSchema),
  updateMyPreferencesController,
);
router.get(
  "/me/attendance-report",
  validateQuery(attendanceReportQuerySchema),
  getMyAttendanceReportController,
);
router.patch(
  "/me/password",
  validateBody(updatePasswordSchema),
  updateMyPasswordController,
);

module.exports = router;
