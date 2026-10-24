const asyncHandler = require("../utils/async-handler");
const {
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  blockUser,
  unblockUser,
  listBlockedUsers,
} = require("../services/account-security.service");
const { getDeletionCheck, requestDeletionCode, deleteMyAccount } = require("../services/account-deletion.service");

/* Changing your sign-in email, blocking people, and deleting your account. */

const respond = (res, message, data) => res.status(200).json({ success: true, message, data });

const requestEmailChangeController = asyncHandler(async (req, res) =>
  respond(res, "Code sent", await requestEmailChange({ userId: req.auth.userId, newEmail: req.body.email })),
);

const confirmEmailChangeController = asyncHandler(async (req, res) =>
  respond(
    res,
    "Email changed",
    await confirmEmailChange({ userId: req.auth.userId, code: req.body.code, currentSessionId: req.auth.sessionId }),
  ),
);

const cancelEmailChangeController = asyncHandler(async (req, res) =>
  respond(res, "Email change cancelled", await cancelEmailChange({ userId: req.auth.userId })),
);

const blockUserController = asyncHandler(async (req, res) =>
  respond(res, "Blocked", await blockUser({ userId: req.auth.userId, targetUserId: req.params.userId })),
);

const unblockUserController = asyncHandler(async (req, res) =>
  respond(res, "Unblocked", await unblockUser({ userId: req.auth.userId, targetUserId: req.params.userId })),
);

const listBlockedUsersController = asyncHandler(async (req, res) =>
  respond(res, "Blocked people fetched", await listBlockedUsers({ userId: req.auth.userId })),
);

const getDeletionCheckController = asyncHandler(async (req, res) =>
  respond(res, "Deletion check", await getDeletionCheck({ userId: req.auth.userId })),
);

const requestDeletionCodeController = asyncHandler(async (req, res) =>
  respond(res, "Code sent", await requestDeletionCode({ userId: req.auth.userId })),
);

const deleteMyAccountController = asyncHandler(async (req, res) =>
  respond(res, "Account deleted", await deleteMyAccount({ userId: req.auth.userId, code: req.body.code })),
);

module.exports = {
  getDeletionCheckController,
  requestDeletionCodeController,
  deleteMyAccountController,
  requestEmailChangeController,
  confirmEmailChangeController,
  cancelEmailChangeController,
  blockUserController,
  unblockUserController,
  listBlockedUsersController,
};
