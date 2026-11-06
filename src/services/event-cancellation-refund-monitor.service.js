const mongoose = require("mongoose");
const env = require("../config/env");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventVendor = require("../models/event-vendor.model");
const User = require("../models/user.model");
const Workspace = require("../models/workspace.model");
const transactionalEmails = require("./transactional-email.service");
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
  const host = await User.findById(event.organizerUserId).select("fullName").lean();
  const workspace = event.workspaceId ? await Workspace.findById(event.workspaceId).select("name").lean() : null;
  const organizerName = workspace?.name || host?.fullName || "";

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
        notifyBuyer: false,
      });

      /* One email that says it's off and what's coming back, once the refund has actually gone out. */
      void transactionalEmails.eventCancelled(ticket.buyerUserId, {
        eventName: event.name,
        startsAt: event.startsAt,
        organizerName,
        reason: event.cancellationReason || "",
        refundNaira: Number(ticket.totalPriceNaira || 0),
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

  /* Friends who paid back a Together share get it back; nothing more is owed. */
  await require("./together.service").settleSharesForCancelledEvent({
    eventId: event._id,
    reason: event.cancellationReason || "Event cancelled",
  });

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
