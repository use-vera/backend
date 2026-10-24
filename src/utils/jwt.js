const jwt = require("jsonwebtoken");
const env = require("../config/env");

const REALTIME_SCOPE = "realtime";

const signAccessToken = (payload) =>
  jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);

/**
 * A short-lived token whose only job is to open a socket.
 *
 * The web app keeps its real bearer token in an httpOnly cookie the browser
 * cannot read, but a socket handshake happens in the browser and needs a
 * token in hand. This one lives for a couple of minutes and is marked
 * `scope: "realtime"`, which authMiddleware refuses, so what reaches the
 * browser cannot be turned around and used against the HTTP API.
 */
const signRealtimeToken = (payload) =>
  jwt.sign({ ...payload, scope: REALTIME_SCOPE }, env.jwtSecret, {
    expiresIn: env.realtimeTokenExpiresIn,
  });

const SIGNUP_SCOPE = "signup";
const SIGNUP_TOKEN_TTL = "30m";

/**
 * Proof that someone just verified an emailed code for an address that has
 * no account yet. It carries the email and nothing else, and is good for
 * one thing: finishing sign-up for that email. authMiddleware refuses it.
 */
const signSignupToken = ({ email }) =>
  jwt.sign({ email, scope: SIGNUP_SCOPE }, env.jwtSecret, {
    expiresIn: SIGNUP_TOKEN_TTL,
  });

const verifySignupToken = (token) => {
  const payload = jwt.verify(token, env.jwtSecret);

  if (payload?.scope !== SIGNUP_SCOPE || !payload.email) {
    throw new jwt.JsonWebTokenError("Not a sign-up token");
  }

  return payload;
};

const signRefreshToken = (payload) =>
  jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });

const verifyRefreshToken = (token) =>
  jwt.verify(token, env.jwtRefreshSecret);

module.exports = {
  REALTIME_SCOPE,
  SIGNUP_SCOPE,
  signAccessToken,
  signSignupToken,
  verifySignupToken,
  signRealtimeToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
