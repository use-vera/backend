const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const UserBlock = require("../models/user-block.model");
const { dispatchEmail } = require("./email.service");
const { emailChanged } = require("../emails/auth.emails");
const { revokeOtherSessions } = require("./session.service");

/* Lazy: auth.service pulls in workspaces and subscriptions. */
const authCodes = () => require("./auth.service");

const toIdString = (value) => String(value?._id || value || "");
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/* ---------- Changing your sign-in email ---------- */

/**
 * Sends a code to the new address. The email only changes once that code
 * comes back, which proves the person can read the new inbox.
 */
const requestEmailChange = async ({ userId, newEmail }) => {
  const email = normalizeEmail(newEmail);
  const user = await User.findById(userId).select("email");

  if (!user) {
    throw new ApiError(404, "User profile not found");
  }

  if (email === user.email) {
    throw new ApiError(400, "That's already your sign-in email.", null, "EMAIL_SAME");
  }

  if (await User.exists({ email, _id: { $ne: user._id } })) {
    throw new ApiError(409, "Another account uses that email.", null, "EMAIL_TAKEN");
  }

  /* Sent before the pending address is stored: if the email can't go out,
     nothing is left half-changed. Cooldowns and limits are the sign-in ones. */
  const sent = await authCodes().requestSignInCode({ email, purpose: "email-change" });
  await User.updateOne({ _id: user._id }, { $set: { pendingEmail: email } });

  return { pendingEmail: email, expiresInSeconds: sent.expiresInSeconds, resendInSeconds: sent.resendInSeconds };
};

/**
 * Checks the code sent to the pending address and makes it the sign-in
 * email. Every other device is signed out, and the old address is told.
 */
const confirmEmailChange = async ({ userId, code, currentSessionId }) => {
  const user = await User.findById(userId).select("+pendingEmail email");

  if (!user?.pendingEmail) {
    throw new ApiError(400, "Start again with your new email.", null, "NO_PENDING_EMAIL");
  }

  const newEmail = user.pendingEmail;
  await authCodes().consumeEmailCode({ email: newEmail, code });

  const oldEmail = user.email;

  try {
    const updated = await User.updateOne(
      { _id: user._id, pendingEmail: newEmail },
      { $set: { email: newEmail, pendingEmail: "" } },
    );

    if (updated.modifiedCount !== 1) {
      throw new ApiError(409, "Start again with your new email.", null, "NO_PENDING_EMAIL");
    }
  } catch (error) {
    /* Someone signed up with that address after the code went out. */
    if (error?.code === 11000) {
      await User.updateOne({ _id: user._id }, { $set: { pendingEmail: "" } });
      throw new ApiError(409, "Another account uses that email.", null, "EMAIL_TAKEN");
    }
    throw error;
  }

  const { revoked } = await revokeOtherSessions({
    userId: user._id,
    exceptSessionId: currentSessionId || null,
    reason: "email_changed",
  });

  void dispatchEmail({ to: oldEmail, ...emailChanged({ newEmail }) });

  return { email: newEmail, otherDevicesSignedOut: revoked };
};

const cancelEmailChange = async ({ userId }) => {
  await User.updateOne({ _id: userId }, { $set: { pendingEmail: "" } });
  return { pendingEmail: "" };
};

/* ---------- Blocking ---------- */

/** Whether either person has blocked the other. */
const isBlockedEitherWay = async (userA, userB) => {
  const a = toIdString(userA);
  const b = toIdString(userB);

  if (!a || !b || a === b) {
    return false;
  }

  return Boolean(
    await UserBlock.exists({
      $or: [
        { blockerUserId: a, blockedUserId: b },
        { blockerUserId: b, blockedUserId: a },
      ],
    }),
  );
};

/** Who `userId` has blocked, and who has blocked them, as one set of ids. */
const blockedIdsAround = async (userId) => {
  const rows = await UserBlock.find({ $or: [{ blockerUserId: userId }, { blockedUserId: userId }] })
    .select("blockerUserId blockedUserId")
    .lean();
  const me = toIdString(userId);
  return new Set(
    rows.map((row) => (toIdString(row.blockerUserId) === me ? toIdString(row.blockedUserId) : toIdString(row.blockerUserId))),
  );
};

const blockUser = async ({ userId, targetUserId }) => {
  const target = toIdString(targetUserId);

  if (!mongoose.isValidObjectId(target)) {
    throw new ApiError(400, "Invalid user id");
  }

  if (target === toIdString(userId)) {
    throw new ApiError(400, "You can't block yourself.", null, "BLOCK_SELF");
  }

  if (!(await User.exists({ _id: target }))) {
    throw new ApiError(404, "User not found", null, "USER_NOT_FOUND");
  }

  await UserBlock.updateOne(
    { blockerUserId: userId, blockedUserId: target },
    { $setOnInsert: { blockerUserId: userId, blockedUserId: target } },
    { upsert: true },
  );

  /* Blocking ends following, both ways. */
  await Follow.deleteMany({
    $or: [
      { followerUserId: userId, followingUserId: target },
      { followerUserId: target, followingUserId: userId },
    ],
  });

  return { userId: target, blocked: true };
};

const unblockUser = async ({ userId, targetUserId }) => {
  await UserBlock.deleteOne({ blockerUserId: userId, blockedUserId: targetUserId });
  return { userId: toIdString(targetUserId), blocked: false };
};

const listBlockedUsers = async ({ userId }) => {
  const rows = await UserBlock.find({ blockerUserId: userId })
    .sort({ createdAt: -1 })
    .populate("blockedUserId", "fullName handle avatarUrl")
    .lean();

  return {
    items: rows
      .filter((row) => row.blockedUserId)
      .map((row) => ({
        _id: toIdString(row.blockedUserId),
        fullName: row.blockedUserId.fullName,
        handle: row.blockedUserId.handle || "",
        avatarUrl: row.blockedUserId.avatarUrl || "",
        blockedAt: row.createdAt,
      })),
  };
};

module.exports = {
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  isBlockedEitherWay,
  blockedIdsAround,
  blockUser,
  unblockUser,
  listBlockedUsers,
};
