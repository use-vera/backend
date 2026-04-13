const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  updateProfileSchema,
  updatePasswordSchema,
  updatePreferencesSchema,
  attendanceReportQuerySchema,
  updateOrganizerBrandingSchema,
} = require("../validations/user.validation");
const {
  getMyProfileController,
  getMySubscriptionController,
  getMyOrganizerBrandingController,
  updateMyProfileController,
  updateMyOrganizerBrandingController,
  updateMyPasswordController,
  getMyPreferencesController,
  updateMyPreferencesController,
  getMyAttendanceReportController,
} = require("../controllers/user.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/me", getMyProfileController);
router.get("/me/subscription", getMySubscriptionController);
router.get("/me/organizer-branding", getMyOrganizerBrandingController);
router.patch("/me", validateBody(updateProfileSchema), updateMyProfileController);
router.patch(
  "/me/organizer-branding",
  validateBody(updateOrganizerBrandingSchema),
  updateMyOrganizerBrandingController,
);
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
