const mongoose = require("mongoose");

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 15;
const MAX_DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// MongoDB write-conflict codes that are safe to retry a transaction on:
// 112 = WriteConflict, 251 = NoSuchTransaction (can surface when a
// conflicting transaction aborts this one server-side mid-flight).
const RETRYABLE_ERROR_CODES = new Set([112, 251]);

const isRetryableTransactionError = (error) =>
  Boolean(error?.hasErrorLabel?.("TransientTransactionError")) ||
  RETRYABLE_ERROR_CODES.has(error?.code) ||
  /please retry|transaction.*aborted/i.test(String(error?.message || ""));

const backoffMs = (attempt) => {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.round(exponential * (0.5 + Math.random()));
};

/**
 * Runs `fn` inside a manually-managed Mongoose session transaction (not
 * session.withTransaction(), whose own internal retry loop was observed
 * hanging well past 30s when two transactions raced on the same unique
 * idempotencyKey — see git history). Managing start/commit/abort directly
 * means only this function's own bounded retry applies, with exponential
 * backoff + jitter for write-hotspot documents like a single organizer's
 * wallet under many concurrent ticket purchases.
 */
const withMongoTransaction = async (fn) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction().catch(() => null);

      if (isRetryableTransactionError(error) && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw new Error("withMongoTransaction: exhausted retries");
};

module.exports = { withMongoTransaction };
