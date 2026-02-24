const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");
const { startPresenceMonitor } = require("./services/presence-monitor.service");

const startServer = async () => {
  try {
    await connectDb();

    app.listen(env.port, env.host, () => {
      // eslint-disable-next-line no-console
      console.log(`Vera backend running on ${env.host}:${env.port}`);
      startPresenceMonitor();
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start backend", error);
    process.exit(1);
  }
};

startServer();
