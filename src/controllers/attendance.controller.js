const asyncHandler = require("../utils/async-handler");
const {
  createAttendanceLog,
  pingAttendanceSession,
  listAttendanceLogs,
  getAttendanceLogById,
} = require("../services/attendance.service");

const checkInController = asyncHandler(async (req, res) => {
  const result = await createAttendanceLog({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
    type: "check-in",
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Checked in successfully",
    data: result,
  });
});

const checkOutController = asyncHandler(async (req, res) => {
  const result = await createAttendanceLog({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
    type: "check-out",
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Checked out successfully",
    data: result,
  });
});

const pingAttendanceController = asyncHandler(async (req, res) => {
  const result = await pingAttendanceSession({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Presence ping recorded",
    data: result,
  });
});

const listAttendanceLogsController = asyncHandler(async (req, res) => {
  const result = await listAttendanceLogs({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
    scope: req.query.scope,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    type: req.query.type,
    from: req.query.from,
    to: req.query.to,
  });

  res.status(200).json({
    success: true,
    message: "Attendance logs fetched",
    data: result,
  });
});

const getAttendanceLogController = asyncHandler(async (req, res) => {
  const result = await getAttendanceLogById({
    workspaceId: req.params.workspaceId,
    userId: req.auth.userId,
    logId: req.params.logId,
  });

  res.status(200).json({
    success: true,
    message: "Attendance log fetched",
    data: result,
  });
});

module.exports = {
  checkInController,
  checkOutController,
  pingAttendanceController,
  listAttendanceLogsController,
  getAttendanceLogController,
};
