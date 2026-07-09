const http = require("http");
const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");
const { startPresenceMonitor } = require("./services/presence-monitor.service");
const { startEventReminderMonitor } = require("./services/event-reminder.service");
const { startChatReminderMonitor } = require("./services/chat-reminder.service");
const {
  startTicketTodoReminderMonitor,
} = require("./services/ticket-todo-reminder.service");
const {
  startTicketResaleMonitor,
} = require("./services/ticket-resale-monitor.service");
const {
  startFeaturedSlotMonitor,
} = require("./services/featured-slot-monitor.service");
const {
  startWalletSettlementMonitor,
} = require("./services/wallet-settlement-monitor.service");
const {
  startCheckoutSessionMonitor,
} = require("./services/checkout-session-monitor.service");
const { initializeSocketServer } = require("./realtime/socket");

const startServer = async () => {
  try {
    await connectDb();

    const httpServer = http.createServer(app);
    initializeSocketServer({ httpServer });

    httpServer.listen(env.port, env.host, () => {
      // eslint-disable-next-line no-console
      console.log(`Vera backend running on ${env.host}:${env.port}`);
      startPresenceMonitor();
      startEventReminderMonitor();
      startChatReminderMonitor();
      startTicketTodoReminderMonitor();
      startTicketResaleMonitor();
      startFeaturedSlotMonitor();
      startWalletSettlementMonitor();
      startCheckoutSessionMonitor();
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start backend", error);
    process.exit(1);
  }
};

startServer();
