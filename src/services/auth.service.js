const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const User = require("../models/user.model");
const Membership = require("../models/membership.model");
const {
  createWorkspace,
  listUserWorkspaces,
} = require("./workspace.service");
const { syncUserSubscriptionState } = require("./subscription.service");

const sanitizeUser = (userDocument) => {
  if (!userDocument) return null;

  const user = userDocument.toObject ? userDocument.toObject() : userDocument;
  delete user.passwordHash;
  delete user.refreshTokenHash;
  delete user.refreshTokenIssuedAt;
  delete user.__v;
  return user;
};

const hashRefreshToken = (refreshToken) =>
  crypto.createHash("sha256").update(String(refreshToken || "")).digest("hex");

const issueUserTokens = async (user) => {
  const token = signAccessToken({ userId: String(user._id) });
  const refreshToken = signRefreshToken({ userId: String(user._id) });

  user.refreshTokenHash = hashRefreshToken(refreshToken);
  user.refreshTokenIssuedAt = new Date();
  await user.save();

  return {
    token,
    refreshToken,
  };
};

const buildAuthResult = async ({ user, bootstrapWorkspace = undefined }) => {
  await syncUserSubscriptionState({ user });
  const workspaces = await listUserWorkspaces(user._id);
  const tokens = await issueUserTokens(user);

  return {
    user: sanitizeUser(user),
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    workspaces,
    ...(bootstrapWorkspace !== undefined
      ? { bootstrapWorkspace: bootstrapWorkspace?.workspace || null }
      : {}),
  };
};

const registerUser = async ({ fullName, email, password, workspaceName }) => {
  const existingUser = await User.findOne({ email }).select(
    "+passwordHash +refreshTokenHash +refreshTokenIssuedAt",
  );

  if (existingUser) {
    const memberships = await Membership.find({
      userId: existingUser._id,
    }).select("status");

    const hasActiveMembership = memberships.some(
      (membership) => membership.status === "active",
    );
    const hasInviteState = memberships.some((membership) =>
      membership.status === "invited" || membership.status === "pending",
    );

    // Allow onboarding invited users who were pre-linked to a workspace but
    // have never become active in any workspace yet.
    if (!hasActiveMembership && hasInviteState) {
      existingUser.fullName = fullName;
      existingUser.passwordHash = await bcrypt.hash(
        password,
        env.bcryptSaltRounds,
      );

      return buildAuthResult({
        user: existingUser,
        bootstrapWorkspace: null,
      });
    }

    throw new ApiError(
      409,
      "Email is already registered. Sign in with that account.",
    );
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

  const user = await User.create({
    fullName,
    email,
    passwordHash,
  });

  let bootstrapWorkspace = null;

  if (workspaceName) {
    bootstrapWorkspace = await createWorkspace({
      ownerUserId: user._id,
      name: workspaceName,
      description: "",
      geofence: {
        name: workspaceName,
        address: "",
        latitude: 0,
        longitude: 0,
        radiusMeters: 150,
      },
    });
  }

  return buildAuthResult({
    user,
    bootstrapWorkspace,
  });
};

const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select(
    "+passwordHash +refreshTokenHash +refreshTokenIssuedAt",
  );

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password");
  }

  user.lastLoginAt = new Date();

  return buildAuthResult({ user });
};

const refreshSession = async ({ refreshToken }) => {
  const normalizedRefreshToken = String(refreshToken || "").trim();

  if (!normalizedRefreshToken) {
    throw new ApiError(400, "Refresh token is required");
  }

  let payload;

  try {
    payload = verifyRefreshToken(normalizedRefreshToken);
  } catch (_error) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(payload.userId).select(
    "+refreshTokenHash +refreshTokenIssuedAt",
  );

  if (!user || !user.refreshTokenHash) {
    throw new ApiError(401, "Session refresh is no longer available");
  }

  const incomingHash = hashRefreshToken(normalizedRefreshToken);

  if (incomingHash !== user.refreshTokenHash) {
    throw new ApiError(401, "Session refresh token is invalid");
  }

  return buildAuthResult({ user });
};

const logoutUser = async ({ refreshToken }) => {
  const normalizedRefreshToken = String(refreshToken || "").trim();

  if (!normalizedRefreshToken) {
    return { revoked: false };
  }

  let payload;

  try {
    payload = verifyRefreshToken(normalizedRefreshToken);
  } catch (_error) {
    return { revoked: false };
  }

  const user = await User.findById(payload.userId).select("+refreshTokenHash");

  if (!user || !user.refreshTokenHash) {
    return { revoked: false };
  }

  const incomingHash = hashRefreshToken(normalizedRefreshToken);

  if (incomingHash !== user.refreshTokenHash) {
    return { revoked: false };
  }

  user.refreshTokenHash = "";
  user.refreshTokenIssuedAt = null;
  await user.save();

  return { revoked: true };
};

module.exports = {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
};
