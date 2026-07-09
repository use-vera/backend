const crypto = require("crypto");

// API secrets are high-entropy random tokens (not human-typed passwords), so
// they're hashed with sha256 for an indexed equality lookup — the same
// pattern auth.service.js uses for refresh tokens — rather than bcrypt,
// which is deliberately slow and has no equality-comparable digest.
const hashApiKeySecret = (secret) =>
  crypto.createHash("sha256").update(String(secret || "")).digest("hex");

const buildPublishableKey = (mode) =>
  `pk_${mode}_${crypto.randomBytes(12).toString("hex")}`;

const buildSecretKey = (mode) => `sk_${mode}_${crypto.randomBytes(24).toString("hex")}`;

/**
 * Generates a full pk_/sk_ key pair for a new ApiKey document. The full
 * secretKey string (not just its random suffix) is what callers send as
 * their Bearer token, so it's also what must be hashed for the stored
 * lookup — hashApiKeySecret(rawKey) in the auth middleware must match this
 * exactly.
 */
const generateApiKeyPair = (mode) => {
  const publishableKey = buildPublishableKey(mode);
  const secretKey = buildSecretKey(mode);

  return {
    publishableKey,
    secretKey,
    secretKeyHash: hashApiKeySecret(secretKey),
    secretKeyLastFour: secretKey.slice(-4),
  };
};

module.exports = {
  hashApiKeySecret,
  generateApiKeyPair,
};
