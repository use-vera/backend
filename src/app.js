const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const routes = require("./routes");
const {
  notFoundMiddleware,
  errorMiddleware,
} = require("./middlewares/error.middleware");
const env = require("./config/env");

const app = express();

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  if (env.corsOrigins.includes("*")) {
    return true;
  }

  return env.corsOrigins.includes(origin);
};

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: env.corsAllowCredentials,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Vera backend is healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", routes);
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Vera API is healthy",
    data: {
      env: env.nodeEnv,
      timestamp: new Date().toISOString(),
    },
  });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
