const dotenv = require("dotenv");

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBoolean = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const toList = (value, fallback) => {
  if (!value || !String(value).trim()) {
    return fallback;
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const defaultMongoUri = "mongodb://127.0.0.1:27017/vera_backend";
const nodeEnv = process.env.NODE_ENV || "development";
const configuredMongoUri = process.env.MONGO_URI || defaultMongoUri;

const env = {
  nodeEnv,
  host: process.env.HOST || "0.0.0.0",
  port: toNumber(process.env.PORT, 5050),
  mongoUri: configuredMongoUri,
  mongoUriFallback: process.env.MONGO_URI_FALLBACK || "",
  mongoAutoIndex: toBoolean(process.env.MONGO_AUTO_INDEX, nodeEnv !== "production"),
  mongoForceIpv4: toBoolean(process.env.MONGO_FORCE_IPV4, false),
  mongoServerSelectionTimeoutMs: toNumber(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    12000,
  ),
  mongoConnectTimeoutMs: toNumber(process.env.MONGO_CONNECT_TIMEOUT_MS, 12000),
  mongoSocketTimeoutMs: toNumber(process.env.MONGO_SOCKET_TIMEOUT_MS, 45000),
  jwtSecret: process.env.JWT_SECRET || "vera_dev_secret_change_me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  bcryptSaltRounds: toNumber(process.env.BCRYPT_SALT_ROUNDS, 12),
  corsOrigins: toList(process.env.CORS_ORIGINS, ["*"]),
  corsAllowCredentials: toBoolean(process.env.CORS_ALLOW_CREDENTIALS, false),
  presenceMonitorEnabled: toBoolean(process.env.PRESENCE_MONITOR_ENABLED, true),
  presenceMonitorTickMs: toNumber(
    process.env.PRESENCE_MONITOR_TICK_MS,
    60 * 1000,
  ),
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || "",
  paystackBaseUrl:
    process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL || "",
  paystackDevBypass: toBoolean(
    process.env.PAYSTACK_DEV_BYPASS,
    nodeEnv !== "production",
  ),
};

if (
  env.nodeEnv === "production" &&
  (!process.env.JWT_SECRET || env.jwtSecret === "vera_dev_secret_change_me")
) {
  throw new Error(
    "JWT_SECRET must be set to a strong value when NODE_ENV=production",
  );
}

module.exports = env;
