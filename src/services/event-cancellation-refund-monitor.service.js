const mongoose = require("mongoose");
const env = require("../config/env");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { refundTicket } = require("./refund.service");
const { createNotification } = require("./notification.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const formatNaira = (naira) => `₦${Math.round(Number(naira || 0)).toLocaleString()}`;

/**
 * Refunds up to 50 still-active tickets for one cancelled event. Errors are
 * caught per-ticket (a single Paystack failure shouldn't block the rest of
 * the sweep) — the ticket's status stays paid/used on failure, so the next
 * tick simply retries it.
 */
const sweepEventTickets = async (event) => {
  const tickets = await EventTicket.find({
    eventId: event._id,
    status: { $in: ["paid", "used"] },
  }).limit(50);

  for (const ticket of tickets) {
    try {
      const result = await refundTicket({
        ticketId: ticket._id,
        actorUserId: event.organizerUserId,
        reason: event.cancellationReason || "Event cancelled",
      });

      await createNotification({
        userId: ticket.buyerUserId,
        type: "ticket.refunded",
        title: "You were refunded",
        message: `${formatNaira(ticket.totalPriceNaira)} was refunded for ${event.name}.`,
        data: { eventId: String(event._id), ticketId: String(ticket._id) },
      });

      void result;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[EventCancellationRefundMonitor] Ticket refund failed", {
        ticketId: String(ticket._id),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = await EventTicket.countDocuments({
    eventId: event._id,
    status: { $in: ["paid", "used"] },
  });

  if (remaining === 0) {
    event.refundSweepCompletedAt = new Date();
    await event.save();
  }
};

const runEventCancellationRefundMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const events = await Event.find({
      status: "cancelled",
      refundSweepCompletedAt: null,
    }).limit(50);

    for (const event of events) {
      await sweepEventTickets(event);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EventCancellationRefundMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startEventCancellationRefundMonitor = () => {
  if (intervalHandle || !env.eventCancellationRefundMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runEventCancellationRefundMonitorTick();
  }, env.eventCancellationRefundMonitorTickMs);

  void runEventCancellationRefundMonitorTick();

  // eslint-disable-next-line no-console
  console.log(
    `[EventCancellationRefundMonitor] Started (tick=${env.eventCancellationRefundMonitorTickMs}ms)`,
  );
};

const stopEventCancellationRefundMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startEventCancellationRefundMonitor,
  stopEventCancellationRefundMonitor,
  runEventCancellationRefundMonitorTick,
  sweepEventTickets,
};
