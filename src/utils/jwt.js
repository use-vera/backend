const jwt = require("jsonwebtoken");
const env = require("../config/env");

const signAccessToken = (payload) =>
  jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
