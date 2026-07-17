const ApiError = require("../utils/api-error");

/**
 * Minimal in-memory sliding-window rate limiter — no new dependency, no
 * shared store. Single-process only by design: this codebase has no
 * shared-store infra (Redis or otherwise), so a multi-instance deployment
 * would need a different backing store. Intended as defense-in-depth
 * behind a domain-level cooldown (e.g. emergency report cooldown), not as
 * the only spam guard.
 */
const rateLimit = ({ windowMs, max, keyFn }) => {
  const hits = new Map();

  return (req, res, next) => {
    const key = keyFn(req);

    if (!key) {
      next();
      return;
    }

    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((ts) => now - ts < windowMs);

    if (timestamps.length >= max) {
      next(new ApiError(429, "Too many requests — please slow down", null, "RATE_LIMITED"));
      return;
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
};

module.exports = { rateLimit };
