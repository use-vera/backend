const crypto = require("crypto");
const ApiError = require("../utils/api-error");
const env = require("../config/env");

const parsePaystackEnvelope = async (response) => {
  const rawText = await response.text();

  if (!rawText) {
    return {
      payload: null,
      rawText: null,
    };
  }

  try {
    return {
      payload: JSON.parse(rawText),
      rawText,
    };
  } catch (_error) {
    return {
      payload: null,
      rawText,
    };
  }
};

const paystackRequest = async (path, { method = "GET", body } = {}) => {
  if (!env.paystackSecretKey) {
    throw new ApiError(503, "PAYSTACK_SECRET_KEY is not configured");
  }

  const url = `${env.paystackBaseUrl}${path}`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ApiError(502, "Could not reach Paystack", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const { payload, rawText } = await parsePaystackEnvelope(response);

  if (!response.ok) {
    throw new ApiError(502, "Paystack request failed", {
      statusCode: response.status,
      payload,
      rawText,
    });
  }

  if (!payload || payload.status !== true || !payload.data) {
    throw new ApiError(502, "Invalid Paystack response", {
      payload,
      rawText,
    });
  }

  return payload.data;
};

const generatePaystackReference = (kind, suffix = "") => {
  const baseKind = String(kind || "payment")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_") || "payment";
  const safeSuffix = String(suffix || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);

  return `vera_${baseKind}${safeSuffix ? `_${safeSuffix}` : ""}_${Date.now()}`;
};

const initializePaystackTransaction = async ({
  email,
  amountKobo,
  callbackUrl,
  reference,
  metadata = {},
  currency = "NGN",
}) =>
  paystackRequest("/transaction/initialize", {
    method: "POST",
    body: {
      email,
      amount: Math.max(1, Math.round(Number(amountKobo || 0))),
      currency,
      reference,
      callback_url: callbackUrl || undefined,
      metadata,
    },
  });

const verifyPaystackTransaction = async (reference) =>
  paystackRequest(`/transaction/verify/${encodeURIComponent(String(reference || "").trim())}`);

const validatePaystackWebhookSignature = (rawBody, signature) => {
  const expected = crypto
    .createHmac("sha512", env.paystackSecretKey || "")
    .update(rawBody)
    .digest("hex");

  const normalizedSignature = String(signature || "").trim().toLowerCase();

  if (!normalizedSignature || normalizedSignature.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(normalizedSignature, "utf8"),
    );
  } catch (_error) {
    return false;
  }
};

const parsePaystackWebhookBody = (rawBody) => {
  const text = Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");

  if (!text.trim()) {
    throw new ApiError(400, "Webhook body is empty");
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new ApiError(400, "Webhook body is not valid JSON");
  }
};

module.exports = {
  generatePaystackReference,
  initializePaystackTransaction,
  verifyPaystackTransaction,
  validatePaystackWebhookSignature,
  parsePaystackWebhookBody,
};
