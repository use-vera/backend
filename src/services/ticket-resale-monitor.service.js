const mongoose = require("mongoose");
const EventTicket = require("../models/event-ticket.model");
const { expireAcceptedResaleOfferById } = require("./event.service");
const env = require("../config/env");

const TICK_MS = Math.max(
  60 * 1000,
  Number(env.ticketResaleMonitorTickMs || 5 * 60 * 1000),
);

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runTicketResaleMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const now = new Date();

    const tickets = await EventTicket.find({
      resaleStatus: "offer-accepted",
      acceptedBidExpiresAt: {
        $ne: null,
        $lte: now,
      },
    })
      .select("_id")
      .sort({ acceptedBidExpiresAt: 1 })
      .limit(200)
      .lean();

    for (const ticket of tickets) {
      await expireAcceptedResaleOfferById(ticket._id, now);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[TicketResaleMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startTicketResaleMonitor = () => {
  if (!env.ticketResaleMonitorEnabled) {
    // eslint-disable-next-line no-console
    console.log("[TicketResaleMonitor] Disabled via TICKET_RESALE_MONITOR_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runTicketResaleMonitorTick();
  }, TICK_MS);

  void runTicketResaleMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[TicketResaleMonitor] Started (tick=${TICK_MS}ms)`);
};

const stopTicketResaleMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startTicketResaleMonitor,
  stopTicketResaleMonitor,
  runTicketResaleMonitorTick,
};
