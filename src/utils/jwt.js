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

const signRefreshToken = (payload) =>
  jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });

const verifyRefreshToken = (token) =>
  jwt.verify(token, env.jwtRefreshSecret);

module.exports = {
  REALTIME_SCOPE,
  signAccessToken,
  signRealtimeToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
};
