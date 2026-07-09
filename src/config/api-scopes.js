const ALL_SCOPES = [
  "events:read",
  "checkout:write",
  "orders:read",
  "tickets:verify",
  "tickets:checkin",
  "refunds:write",
];

// Publishable (pk_) keys are meant to be embeddable in client-side code, so
// their effective scopes are hard-capped to read-only regardless of what's
// stored on the ApiKey row — defense in depth against a leaked pk_ key ever
// being able to move money or check in tickets.
const PUBLISHABLE_ALLOWED_SCOPES = ["events:read"];

module.exports = { ALL_SCOPES, PUBLISHABLE_ALLOWED_SCOPES };
