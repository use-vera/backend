const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const {
  verifyRefreshToken,
  signSignupToken,
  verifySignupToken,
} = require("../utils/jwt");
const User = require("../models/user.model");
const UserSession = require("../models/user-session.model");
const Membership = require("../models/membership.model");
const EmailOtp = require("../models/email-otp.model");
const { sendEmail, isEmailEnabled } = require("./email.service");
const {
  signInCode: signInCodeEmail,
  emailChangeCode: emailChangeCodeEmail,
  accountDeleteCode: accountDeleteCodeEmail,
} = require("../emails/auth.emails");
const {
  createWorkspace,
  listUserWorkspaces,
} = require("./workspace.service");
const { syncUserSubscriptionState } = require("./subscription.service");
const {
  hashRefreshToken,
  createSession,
  rotateSession,
  revokeSession,
} = require("./session.service");

const sanitizeUser = (userDocument) => {
  if (!userDocument) return null;

  const user = userDocument.toObject ? userDocument.toObject() : userDocument;
  delete user.passwordHash;
  delete user.refreshTokenHash;
  delete user.refreshTokenIssuedAt;
  delete user.__v;
  return user;
};

/**
 * Signs a user in on a device. `context` describes the device ({ device,
 * ip, userAgent }); `tokens` is passed when a refresh already rotated the
 * session, so no new one is made.
 */
const buildAuthResult = async ({ user, bootstrapWorkspace = undefined, context = {}, tokens = null }) => {
  await syncUserSubscriptionState({ user });
  if (user.isModified()) await user.save();
  const workspaces = await listUserWorkspaces(user._id);
  const issued = tokens || (await createSession({ userId: user._id, context }));

  return {
    user: sanitizeUser(user),
    token: issued.token,
    refreshToken: issued.refreshToken,
    workspaces,
    ...(bootstrapWorkspace !== undefined
      ? { bootstrapWorkspace: bootstrapWorkspace?.workspace || null }
      : {}),
  };
};

const registerUser = async ({ fullName, email, password, workspaceName }, context = {}) => {
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
        context,
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
    context,
  });
};

const loginUser = async ({ email, password }, context = {}) => {
  const user = await User.findOne({ email }).select(
    "+passwordHash +refreshTokenHash +refreshTokenIssuedAt",
  );

  /* No hash means the account was made with an emailed code and has never
     had a password; answer exactly as for a wrong password. */
  if (!user || !user.passwordHash) {
    throw new ApiError(401, "Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password");
  }

  user.lastLoginAt = new Date();

  return buildAuthResult({ user, context });
};

const refreshSession = async ({ refreshToken }, context = {}) => {
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

  if (!user) {
    throw new ApiError(401, "Session refresh is no longer available");
  }

  if (payload.sid) {
    const tokens = await rotateSession({
      sessionId: payload.sid,
      userId: user._id,
      refreshToken: normalizedRefreshToken,
      context,
    });
    return buildAuthResult({ user, tokens });
  }

  /* A token from before sessions existed: checked against the one hash the
     account used to keep, then moved onto a session of its own. */
  if (!user.refreshTokenHash || hashRefreshToken(normalizedRefreshToken) !== user.refreshTokenHash) {
    throw new ApiError(401, "Session refresh token is invalid");
  }

  user.refreshTokenHash = "";
  user.refreshTokenIssuedAt = null;

  return buildAuthResult({ user, context });
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

  if (payload.sid) {
    /* Only the holder of this session's current refresh token can end it
       this way; anyone else gets the same quiet "nothing to revoke". */
    const session = await UserSession.findOne({ _id: payload.sid, userId: payload.userId, revokedAt: null }).select(
      "+refreshTokenHash",
    );

    if (!session || session.refreshTokenHash !== hashRefreshToken(normalizedRefreshToken)) {
      return { revoked: false };
    }

    await revokeSession({ userId: payload.userId, sessionId: payload.sid, reason: "signed_out" });
    return { revoked: true };
  }

  const user = await User.findById(payload.userId).select("+refreshTokenHash");

  if (!user || !user.refreshTokenHash || hashRefreshToken(normalizedRefreshToken) !== user.refreshTokenHash) {
    return { revoked: false };
  }

  user.refreshTokenHash = "";
  user.refreshTokenIssuedAt = null;
  await user.save();

  return { revoked: true };
};

/* ---------- Passwordless sign-in: an emailed six-digit code ---------- */

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_WRONG_ATTEMPTS = 5;

/* Keyed to the email as well as the code, so one stored hash can't be
   replayed against another inbox, and peppered with a server secret so a
   leaked table can't be brute-forced offline in a million guesses. */
const hashSignInCode = ({ email, code }) =>
  crypto
    .createHmac("sha256", `${env.jwtSecret}:sign-in-code`)
    .update(`${email}:${code}`)
    .digest("hex");

const generateSignInCode = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

const codesMatch = (expectedHash, actualHash) => {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");

  return (
    expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  );
};

/**
 * Emails a fresh code. Answers the same whether or not an account exists
 * for the address, so the endpoint can't be used to find out who is on Vera.
 */
const requestSignInCode = async ({ email, purpose = "sign-in" }) => {
  const now = new Date();
  const existing = await EmailOtp.findOne({ email });

  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    throw new ApiError(
      429,
      "Give it a few seconds before asking for another code.",
      null,
      "OTP_COOLDOWN",
    );
  }

  const windowIsOpen =
    existing && now - existing.sendWindowStartedAt < SEND_WINDOW_MS;

  if (windowIsOpen && existing.sendsInWindow >= MAX_SENDS_PER_WINDOW) {
    throw new ApiError(
      429,
      "Too many codes asked for. Try again in an hour.",
      null,
      "OTP_SEND_LIMIT",
    );
  }

  const code = generateSignInCode();

  await EmailOtp.findOneAndUpdate(
    { email },
    {
      $set: {
        codeHash: hashSignInCode({ email, code }),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        attempts: 0,
        lastSentAt: now,
        sendWindowStartedAt: windowIsOpen ? existing.sendWindowStartedAt : now,
        sendsInWindow: windowIsOpen ? existing.sendsInWindow + 1 : 1,
      },
    },
    { upsert: true },
  );

  const template =
    purpose === "email-change"
      ? emailChangeCodeEmail
      : purpose === "account-delete"
        ? accountDeleteCodeEmail
        : signInCodeEmail;
  const message = template({
    code,
    expiresInMinutes: CODE_TTL_MS / 60000,
  });

  try {
    await sendEmail({ to: email, ...message });
  } catch (error) {
    /* A code nobody received must not hold the inbox in a cooldown. */
    await EmailOtp.deleteOne({ email });
    throw error;
  }

  /* With no email provider configured nobody could ever sign in locally.
     Development only: a code is a credential and never belongs in
     production logs. */
  if (!isEmailEnabled() && env.nodeEnv !== "production") {
    console.info(`[auth] dev sign-in code for ${email}: ${code}`);
  }

  return {
    email,
    expiresInSeconds: CODE_TTL_MS / 1000,
    resendInSeconds: RESEND_COOLDOWN_MS / 1000,
  };
};

/**
 * Checks an emailed code for `email` and uses it up. Throws OTP_* errors.
 * Shared by sign-in and by changing your sign-in email, which both prove
 * the person can read that inbox.
 */
const consumeEmailCode = async ({ email, code }) => {
  const otp = await EmailOtp.findOne({ email });

  if (!otp || otp.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      400,
      "That code has expired. Ask for a new one.",
      null,
      "OTP_EXPIRED",
    );
  }

  if (otp.attempts >= MAX_WRONG_ATTEMPTS) {
    throw new ApiError(
      429,
      "Too many wrong codes. Ask for a new one.",
      null,
      "OTP_LOCKED",
    );
  }

  const submittedHash = hashSignInCode({ email, code });

  if (!codesMatch(otp.codeHash, submittedHash)) {
    await EmailOtp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw new ApiError(400, "That code isn't right.", null, "OTP_INVALID");
  }

  /* Deleting by hash makes the code single-use even if two requests carry
     it at the same moment: only one of them gets the row back. */
  const consumed = await EmailOtp.findOneAndDelete({
    _id: otp._id,
    codeHash: otp.codeHash,
  });

  if (!consumed) {
    throw new ApiError(
      400,
      "That code has expired. Ask for a new one.",
      null,
      "OTP_EXPIRED",
    );
  }
};

/**
 * Checks a code. An existing account is signed straight in. An address with
 * no account gets a short-lived sign-up token instead: the person still has
 * to tell us their name before an account exists.
 */
const verifySignInCode = async ({ email, code }, context = {}) => {
  await consumeEmailCode({ email, code });

  const user = await User.findOne({ email }).select(
    "+refreshTokenHash +refreshTokenIssuedAt",
  );

  if (!user) {
    return {
      status: "needs_profile",
      email,
      signupToken: signSignupToken({ email }),
    };
  }

  user.lastLoginAt = new Date();

  return {
    status: "signed_in",
    ...(await buildAuthResult({ user, context })),
  };
};

/** Creates the account for a verified email, then signs it in. */
const completeSignUp = async ({
  signupToken,
  fullName,
  phoneNumber,
  marketingOptIn,
}, context = {}) => {
  let email;

  try {
    ({ email } = verifySignupToken(signupToken));
  } catch (_error) {
    throw new ApiError(
      401,
      "This sign-up has expired. Start again with your email.",
      null,
      "SIGNUP_TOKEN_INVALID",
    );
  }

  const signInExisting = async () => {
    const user = await User.findOne({ email }).select(
      "+refreshTokenHash +refreshTokenIssuedAt",
    );
    user.lastLoginAt = new Date();
    return buildAuthResult({ user, context });
  };

  /* A double-tapped "Join" lands here twice; the second one signs in. */
  if (await User.exists({ email })) {
    return signInExisting();
  }

  const now = new Date();

  try {
    const user = await User.create({
      fullName,
      email,
      phoneNumber: phoneNumber || "",
      termsAcceptedAt: now,
      onboardingCompletedAt: null,
      lastLoginAt: now,
      preferences: { marketingOptIn: Boolean(marketingOptIn) },
    });

    return buildAuthResult({ user, context });
  } catch (error) {
    if (error?.code === 11000) {
      return signInExisting();
    }

    throw error;
  }
};

module.exports = {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  requestSignInCode,
  consumeEmailCode,
  verifySignInCode,
  completeSignUp,
};
