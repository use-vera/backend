const mongoose = require("mongoose");
const env = require("../config/env");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventVendor = require("../models/event-vendor.model");
const { refundTicket, refundStallFee } = require("./refund.service");
const { readPaystackError } = require("./payment-refund.service");
const { cancelResaleSalesForEvent } = require("./resale-payout.service");

/* The reason Paystack gave, not just "request failed", so a log line says
   what to do. */
const describeRefundError = (error) => {
  const { code, message } = readPaystackError(error);
  return {
    reason: error instanceof Error ? error.message : String(error),
    ...(code ? { paystackCode: code, paystackMessage: message } : {}),
  };
};
const {
  refundOrdersForCancelledEvent,
} = require("./vendor-order.service");
const { createNotification } = require("./notification.service");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const formatNaira = (naira) => `₦${Math.round(Number(naira || 0)).toLocaleString()}`;

/**
 * Refunds up to 50 still-active tickets for one cancelled event. Errors are
 * caught per-ticket (a single Paystack failure shouldn't block the rest of
 * the sweep). The ticket's status stays paid/used on failure, so the next
 * tick simply retries it.
 */
/**
 * Settles the vendor side of a cancelled event: buyers get back what they
 * paid for food nobody will make, vendors get their stall fee back out of
 * the organizer's wallet, and the bookings are closed so nobody turns up.
 */
const sweepEventVendors = async (event) => {
  const reason = event.cancellationReason || "Event cancelled";

  await refundOrdersForCancelledEvent({ eventId: event._id, reason });

  const bookings = await EventVendor.find({
    eventId: event._id,
    status: { $in: ["invited", "applied", "confirmed"] },
  }).limit(100);

  for (const booking of bookings) {
    try {
      await refundStallFee({ bookingId: booking._id, reason });

      await EventVendor.updateOne(
        { _id: booking._id },
        {
          $set: {
            status: "cancelled",
            respondedAt: new Date(),
            responseNote: reason,
            stallFeeDueAt: null,
          },
        },
      );
    } catch (error) {
      /* Left as it is so the next tick retries this one booking. */
      // eslint-disable-next-line no-console
      console.error("[EventCancellationRefundMonitor] Vendor refund failed", {
        bookingId: String(booking._id),
        ...describeRefundError(error),
      });
    }
  }
};

const sweepEventTickets = async (event) => {
  const tickets = await EventTicket.find({
    eventId: event._id,
    status: { $in: ["paid", "used"] },
    /* Flagged for a person: retrying cannot fix these. */
    "refundAttention.at": null,
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
        ...describeRefundError(error),
      });
    }
  }

  await sweepEventVendors(event);

  /* Resales on this event: no payouts, and sellers get back what they paid. */
  try {
    await cancelResaleSalesForEvent(event);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EventCancellationRefundMonitor] Resale cancellation failed", {
      eventId: String(event._id),
      ...describeRefundError(error),
    });
  }

  const remaining = await EventTicket.countDocuments({
    eventId: event._id,
    status: { $in: ["paid", "used"] },
  });

  const vendorsLeft = await EventVendor.countDocuments({
    eventId: event._id,
    status: { $in: ["invited", "applied", "confirmed"] },
  });

  if (remaining === 0 && vendorsLeft === 0) {
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
