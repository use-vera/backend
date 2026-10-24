const ApiError = require("../utils/api-error");
const env = require("../config/env");
const {
  initiatePaystackRefund,
  verifyPaystackTransaction,
} = require("./paystack.service");

/** Paystack's own error code and message, when the failure came from Paystack. */
const readPaystackError = (error) => {
  const payload = error?.details?.payload;
  return {
    code: typeof payload?.code === "string" ? payload.code : "",
    message:
      typeof payload?.message === "string"
        ? payload.message
        : error instanceof Error
          ? error.message
          : String(error),
  };
};

const isPaystackTestMode = () => String(env.paystackSecretKey || "").startsWith("sk_test_");

/**
 * Gives a buyer their money back through Paystack, and says what happened.
 *
 * Outcomes:
 * - "refunded": Paystack accepted the refund.
 * - "already_refunded": Paystack had already reversed this payment (a retry
 *   after a crash between the refund and our own bookkeeping).
 * - "no_provider_payment": test mode only. Paystack has no record of the
 *   payment (seeded data, dev-bypass checkouts), so no real money moved and
 *   there is nothing to send back.
 *
 * Anything else throws, with Paystack's own reason in the message. In live
 * mode a payment Paystack cannot find is never treated as refunded: it
 * throws PAYMENT_NOT_FOUND_AT_PROVIDER so a person looks at it.
 */
const returnPaystackPayment = async ({ reference, amountKobo }) => {
  try {
    const refund = await initiatePaystackRefund({
      transactionReference: reference,
      amountKobo,
    });
    return { outcome: "refunded", refund };
  } catch (error) {
    const { code, message } = readPaystackError(error);

    if (code === "transaction_not_found") {
      if (isPaystackTestMode()) {
        // eslint-disable-next-line no-console
        console.warn("[payment-refund] No Paystack payment to refund (test mode)", { reference });
        return { outcome: "no_provider_payment", refund: null };
      }

      throw new ApiError(
        409,
        `Paystack has no payment ${reference} to refund. This needs a manual refund.`,
        { paystackCode: code, paystackMessage: message },
        "PAYMENT_NOT_FOUND_AT_PROVIDER",
      );
    }

    /* Before calling it a failure, check whether the money already went
       back: Paystack rejects a second refund of a reversed payment. */
    try {
      const transaction = await verifyPaystackTransaction(reference);
      if (String(transaction?.status || "").toLowerCase() === "reversed") {
        return { outcome: "already_refunded", refund: null };
      }
    } catch {
      // Fall through to the original failure.
    }

    throw new ApiError(
      502,
      `Paystack refused the refund: ${message}`,
      { paystackCode: code, paystackMessage: message },
      "PAYSTACK_REFUND_FAILED",
    );
  }
};

module.exports = { returnPaystackPayment, readPaystackError, isPaystackTestMode };
