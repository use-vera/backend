const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
  joinRequestCreateSchema,
  joinRequestParamsSchema,
  updateMemberRoleParamsSchema,
  listMembersQuerySchema,
  memberDetailsQuerySchema,
  updateMemberRoleBodySchema,
} = require("../validations/workspace.validation");
const {
  workspaceAttendancePayloadSchema,
  attendanceLogParamsSchema,
  attendanceLogsQuerySchema,
} = require("../validations/attendance.validation");
const { createWorkspaceInviteSchema } = require("../validations/invite.validation");
const {
  createRecurringEventSchema,
  updateRecurringEventSchema,
  recurringEventParamsSchema,
  recurringEventAttendanceQuerySchema,
} = require("../validations/recurring-event.validation");
const {
  createWorkspaceController,
  listWorkspacesController,
  getWorkspaceController,
  updateWorkspaceController,
  requestJoinWorkspaceController,
  listJoinRequestsController,
  approveJoinRequestController,
  rejectJoinRequestController,
  listMembersController,
  getMemberDetailsController,
  updateMemberRoleController,
  promoteMemberToAdminController,
} = require("../controllers/workspace.controller");
const {
  createWorkspaceInviteController,
  listWorkspaceInvitesController,
} = require("../controllers/invite.controller");
const {
  checkInController,
  checkOutController,
  pingAttendanceController,
  listAttendanceLogsController,
  getAttendanceLogController,
} = require("../controllers/attendance.controller");
const {
  createRecurringEventController,
  listRecurringEventsController,
  updateRecurringEventController,
  listRecurringEventAttendanceController,
} = require("../controllers/recurring-event.controller");

const router = express.Router();

router.use(authMiddleware);

router.post("/", validateBody(createWorkspaceSchema), createWorkspaceController);
router.get("/", listWorkspacesController);

router.get(
  "/:workspaceId",
  validateParams(workspaceParamsSchema),
  getWorkspaceController,
);
router.patch(
  "/:workspaceId",
  validateParams(workspaceParamsSchema),
  validateBody(updateWorkspaceSchema),
  updateWorkspaceController,
);

router.get(
  "/:workspaceId/members",
  validateParams(workspaceParamsSchema),
  validateQuery(listMembersQuerySchema),
  listMembersController,
);
router.get(
  "/:workspaceId/members/:memberId/details",
  validateParams(updateMemberRoleParamsSchema),
  validateQuery(memberDetailsQuerySchema),
  getMemberDetailsController,
);
router.patch(
  "/:workspaceId/members/:memberId/role",
  validateParams(updateMemberRoleParamsSchema),
  validateBody(updateMemberRoleBodySchema),
  updateMemberRoleController,
);
router.post(
  "/:workspaceId/admins/:memberId",
  validateParams(updateMemberRoleParamsSchema),
  promoteMemberToAdminController,
);

router.post(
  "/:workspaceId/invites",
  validateParams(workspaceParamsSchema),
  validateBody(createWorkspaceInviteSchema),
  createWorkspaceInviteController,
);
router.get(
  "/:workspaceId/invites",
  validateParams(workspaceParamsSchema),
  listWorkspaceInvitesController,
);

router.post(
  "/:workspaceId/join-requests",
  validateParams(workspaceParamsSchema),
  validateBody(joinRequestCreateSchema),
  requestJoinWorkspaceController,
);
router.get(
  "/:workspaceId/join-requests",
  validateParams(workspaceParamsSchema),
  listJoinRequestsController,
);
router.post(
  "/:workspaceId/join-requests/:requestId/approve",
  validateParams(joinRequestParamsSchema),
  approveJoinRequestController,
);
router.post(
  "/:workspaceId/join-requests/:requestId/reject",
  validateParams(joinRequestParamsSchema),
  rejectJoinRequestController,
);

router.post(
  "/:workspaceId/attendance/check-in",
  validateParams(workspaceParamsSchema),
  validateBody(workspaceAttendancePayloadSchema),
  checkInController,
);
router.post(
  "/:workspaceId/attendance/check-out",
  validateParams(workspaceParamsSchema),
  validateBody(workspaceAttendancePayloadSchema),
  checkOutController,
);
router.post(
  "/:workspaceId/attendance/ping",
  validateParams(workspaceParamsSchema),
  validateBody(workspaceAttendancePayloadSchema),
  pingAttendanceController,
);
router.get(
  "/:workspaceId/attendance/logs",
  validateParams(workspaceParamsSchema),
  validateQuery(attendanceLogsQuerySchema),
  listAttendanceLogsController,
);
router.get(
  "/:workspaceId/attendance/logs/:logId",
  validateParams(attendanceLogParamsSchema),
  getAttendanceLogController,
);

router.post(
  "/:workspaceId/recurring-events",
  validateParams(workspaceParamsSchema),
  validateBody(createRecurringEventSchema),
  createRecurringEventController,
);
router.get(
  "/:workspaceId/recurring-events",
  validateParams(workspaceParamsSchema),
  listRecurringEventsController,
);
router.patch(
  "/:workspaceId/recurring-events/:eventId",
  validateParams(recurringEventParamsSchema),
  validateBody(updateRecurringEventSchema),
  updateRecurringEventController,
);
router.get(
  "/:workspaceId/recurring-events/:eventId/attendance",
  validateParams(recurringEventParamsSchema),
  validateQuery(recurringEventAttendanceQuerySchema),
  listRecurringEventAttendanceController,
);

module.exports = router;
