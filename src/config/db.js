const mongoose = require("mongoose");
const env = require("./env");

let listenersAttached = false;

const getMongoTargetLabel = (uri) => {
  const raw = String(uri || "");
  const withoutProtocol = raw.replace(/^mongodb(\+srv)?:\/\//, "");
  const withoutCredentials = withoutProtocol.includes("@")
    ? withoutProtocol.split("@")[1]
    : withoutProtocol;

  return withoutCredentials.split("/")[0] || "unknown-target";
};

const isAtlasConnectivityIssue = (error, uri) => {
  if (!String(uri || "").includes("mongodb.net")) {
    return false;
  }

  const text = `${error?.name || ""} ${error?.message || ""} ${error?.reason?.type || ""}`.toLowerCase();

  return [
    "could not connect to any servers",
    "replicasetnoprimary",
    "server selection timed out",
    "econnreset",
    "enotfound",
    "eai_again",
    "timed out",
  ].some((token) => text.includes(token));
};

const attachDbListeners = () => {
  if (listenersAttached) {
    return;
  }

  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    // eslint-disable-next-line no-console
    console.log("[DB] Connected");
  });

  mongoose.connection.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("[DB] Disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    // eslint-disable-next-line no-console
    console.log("[DB] Reconnected");
  });

  mongoose.connection.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.warn("[DB] Connection error:", error?.message || error);
  });
};

const buildMongoOptions = () => ({
  autoIndex: env.mongoAutoIndex,
  serverSelectionTimeoutMS: env.mongoServerSelectionTimeoutMs,
  connectTimeoutMS: env.mongoConnectTimeoutMs,
  socketTimeoutMS: env.mongoSocketTimeoutMs,
  ...(env.mongoForceIpv4 ? { family: 4 } : {}),
});

const tryConnect = async ({ uri, label }) => {
  const target = getMongoTargetLabel(uri);
  // eslint-disable-next-line no-console
  console.log(`[DB] Connecting (${label}) -> ${target}`);

  if (label === "fallback") {
    // eslint-disable-next-line no-console
    console.warn("[DB] Using fallback Mongo URI. Data may differ from primary.");
  }

  await mongoose.connect(uri, buildMongoOptions());

  // eslint-disable-next-line no-console
  console.log(`[DB] Connected (${label}) -> ${target}`);
};

const connectDb = async () => {
  mongoose.set("strictQuery", true);
  attachDbListeners();

  const attempts = [{ uri: env.mongoUri, label: "primary" }];

  if (env.mongoUriFallback && env.mongoUriFallback !== env.mongoUri) {
    attempts.push({ uri: env.mongoUriFallback, label: "fallback" });
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      await tryConnect(attempt);
      return;
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-console
      console.error(
        `[DB] ${attempt.label} connection failed -> ${getMongoTargetLabel(attempt.uri)} :: ${error?.message || error}`,
      );

      if (isAtlasConnectivityIssue(error, attempt.uri)) {
        // eslint-disable-next-line no-console
        console.error(
          "[DB] Atlas connectivity hint: verify IP access list, DB user credentials, and cluster availability.",
        );
      }

      try {
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
      } catch (_disconnectError) {
        // Ignore cleanup failures between attempts.
      }
    }
  }

  throw lastError;
};

module.exports = { connectDb };
