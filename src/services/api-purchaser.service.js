const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const User = require("../models/user.model");

/**
 * Resolves the Vera User a Developer Platform checkout purchase should be
 * attributed to. Third-party businesses' end customers won't already have a
 * Vera account, so this find-or-creates one directly — deliberately NOT
 * reusing auth.service.js's registerUser, which issues real JWTs,
 * bootstraps a Workspace, and 409s on an existing email. An existing email
 * here is success (the same repeat buyer across integrations), not an
 * error.
 */
const findOrCreateApiPurchaser = async ({ email, fullName }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw new ApiError(400, "customerEmail is required", null, "VALIDATION_ERROR");
  }

  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    return existing;
  }

  const randomPassword = crypto.randomBytes(24).toString("hex");
  const passwordHash = await bcrypt.hash(randomPassword, env.bcryptSaltRounds);

  return User.create({
    fullName: String(fullName || "").trim() || "Vera Guest",
    email: normalizedEmail,
    passwordHash,
  });
};

module.exports = { findOrCreateApiPurchaser };
