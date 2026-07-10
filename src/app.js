const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const routes = require("./routes");
const paymentRoutes = require("./routes/payment.routes");
const publicEventRoutes = require("./routes/public-event.routes");
const publicCategoryRoutes = require("./routes/public-category.routes");
const v1Routes = require("./routes/v1.routes");
const {
  notFoundMiddleware,
  errorMiddleware,
} = require("./middlewares/error.middleware");
const env = require("./config/env");

const app = express();

// So req.ip reflects the real client address (used by the Developer
// Platform's API request audit log) rather than a reverse proxy's address,
// when this backend runs behind one. Single-hop default — adjust if the
// deployment topology sits behind more than one proxy.
app.set("trust proxy", 1);

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
app.use("/api/payments", paymentRoutes);
app.use("/api/public/events", publicEventRoutes);
app.use("/api/public/categories", publicCategoryRoutes);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.resolve(__dirname, "..", "uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Vera backend is healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", routes);
app.use("/v1", v1Routes);
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
