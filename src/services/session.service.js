const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const UserSession = require("../models/user-session.model");
const { signAccessToken, signRefreshToken } = require("../utils/jwt");

const hashRefreshToken = (refreshToken) =>
  crypto.createHash("sha256").update(String(refreshToken || "")).digest("hex");

const codesMatch = (expectedHex, actualHex) => {
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  const actual = Buffer.from(String(actualHex || ""), "hex");
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

/* When a refresh token runs out, read from the token itself so it always
   matches what was signed. */
const expiryOf = (refreshToken) => {
  const decoded = jwt.decode(refreshToken);
  return decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
};

const PLATFORMS = new Set(["ios", "android", "web"]);

/* What we know about the device, cleaned: it comes from the client. */
const describeDevice = ({ device = {}, userAgent = "" } = {}) => ({
  deviceName: String(device.name || "").trim().slice(0, 80),
  platform: PLATFORMS.has(device.platform) ? device.platform : "unknown",
  appVersion: String(device.appVersion || "").trim().slice(0, 32),
  userAgent: String(userAgent || "").trim().slice(0, 300),
});

const signTokens = (userId, sessionId) => {
  const claims = { userId: String(userId), sid: String(sessionId) };
  /* A random id keeps two refresh tokens signed in the same second apart. */
  return {
    token: signAccessToken(claims),
    refreshToken: signRefreshToken({ ...claims, jti: crypto.randomUUID() }),
  };
};

/** A new signed-in device: its own session and its own tokens. */
const createSession = async ({ userId, context = {} }) => {
  const session = new UserSession({
    userId,
    ...describeDevice(context),
    lastIp: String(context.ip || "").slice(0, 64),
    refreshTokenHash: "pending",
    expiresAt: new Date(),
  });
  const tokens = signTokens(userId, session._id);
  session.refreshTokenHash = hashRefreshToken(tokens.refreshToken);
  session.expiresAt = expiryOf(tokens.refreshToken);
  await session.save();

  return { ...tokens, sessionId: String(session._id) };
};

/**
 * Swaps a refresh token for new tokens on the same session. The swap is a
 * compare-and-set on the old hash, so two refreshes racing with the same
 * token can't both succeed.
 */
const rotateSession = async ({ sessionId, userId, refreshToken, context = {} }) => {
  const session = await UserSession.findOne({ _id: sessionId, userId }).select("+refreshTokenHash");

  if (!session || session.revokedAt) {
    throw new ApiError(401, "This device was signed out", null, "SESSION_REVOKED");
  }

  const incomingHash = hashRefreshToken(refreshToken);

  if (!codesMatch(session.refreshTokenHash, incomingHash)) {
    throw new ApiError(401, "Session refresh token is invalid", null, "SESSION_INVALID");
  }

  const tokens = signTokens(userId, session._id);
  const device = describeDevice(context);
  const updated = await UserSession.updateOne(
    { _id: session._id, refreshTokenHash: incomingHash, revokedAt: null },
    {
      $set: {
        refreshTokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: expiryOf(tokens.refreshToken),
        lastUsedAt: new Date(),
        ...(context.ip ? { lastIp: String(context.ip).slice(0, 64) } : {}),
        ...(device.deviceName ? { deviceName: device.deviceName } : {}),
        ...(device.platform !== "unknown" ? { platform: device.platform } : {}),
        ...(device.appVersion ? { appVersion: device.appVersion } : {}),
      },
    },
  );

  if (updated.modifiedCount !== 1) {
    throw new ApiError(401, "Session refresh token is invalid", null, "SESSION_INVALID");
  }

  return { ...tokens, sessionId: String(session._id) };
};

/** For the auth middleware: is this session still signed in? */
const isSessionActive = async (sessionId) =>
  Boolean(await UserSession.exists({ _id: sessionId, revokedAt: null, expiresAt: { $gt: new Date() } }));

/* lastUsedAt moves at most every few minutes, so a busy app isn't a write
   on every request. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const touchSession = (sessionId) =>
  UserSession.updateOne(
    { _id: sessionId, lastUsedAt: { $lt: new Date(Date.now() - TOUCH_EVERY_MS) } },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => null);

const listSessions = async ({ userId, currentSessionId }) => {
  const sessions = await UserSession.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();

  return {
    items: sessions.map((session) => ({
      _id: String(session._id),
      deviceName: session.deviceName,
      platform: session.platform,
      appVersion: session.appVersion,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      isCurrent: String(session._id) === String(currentSessionId || ""),
    })),
  };
};

const revokeSession = async ({ userId, sessionId, reason = "signed_out" }) => {
  const result = await UserSession.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  if (result.matchedCount === 0) {
    throw new ApiError(404, "That device isn't signed in", null, "SESSION_NOT_FOUND");
  }

  return { revoked: true };
};

/** Signs out every device but the one asking (or all of them, with no exception). */
const revokeOtherSessions = async ({ userId, exceptSessionId = null, reason = "signed_out_elsewhere" }) => {
  const filter = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await UserSession.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  /* A device still on a token from before sessions existed is cut off too:
     its refresh token was the one hash the account used to keep. */
  await User.updateOne({ _id: userId }, { $set: { refreshTokenHash: "", refreshTokenIssuedAt: null } });
  return { revoked: result.modifiedCount };
};

module.exports = {
  hashRefreshToken,
  createSession,
  rotateSession,
  isSessionActive,
  touchSession,
  listSessions,
  revokeSession,
  revokeOtherSessions,
};
