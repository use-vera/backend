const bcrypt = require("bcryptjs");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const { signAccessToken } = require("../utils/jwt");
const User = require("../models/user.model");
const Membership = require("../models/membership.model");
const {
  createWorkspace,
  listUserWorkspaces,
} = require("./workspace.service");

const sanitizeUser = (userDocument) => {
  if (!userDocument) return null;

  const user = userDocument.toObject ? userDocument.toObject() : userDocument;
  delete user.passwordHash;
  delete user.__v;
  return user;
};

const registerUser = async ({ fullName, email, password, workspaceName }) => {
  const existingUser = await User.findOne({ email }).select("+passwordHash");

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

      await existingUser.save();

      const token = signAccessToken({ userId: String(existingUser._id) });
      const workspaces = await listUserWorkspaces(existingUser._id);

      return {
        user: sanitizeUser(existingUser),
        token,
        workspaces,
        bootstrapWorkspace: null,
      };
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

  const token = signAccessToken({ userId: String(user._id) });
  const workspaces = await listUserWorkspaces(user._id);

  return {
    user: sanitizeUser(user),
    token,
    workspaces,
    bootstrapWorkspace: bootstrapWorkspace?.workspace || null,
  };
};

const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signAccessToken({ userId: String(user._id) });
  const workspaces = await listUserWorkspaces(user._id);

  return {
    user: sanitizeUser(user),
    token,
    workspaces,
  };
};

module.exports = {
  registerUser,
  loginUser,
};
