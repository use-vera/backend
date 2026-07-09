const mongoose = require("mongoose");
const env = require("../config/env");
const CheckoutSession = require("../models/checkout-session.model");
const EventTicket = require("../models/event-ticket.model");

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Expires one stale reserved CheckoutSession. Re-fetches under the same
 * filter used by the scan (race guard against a client's GET or an
 * incoming webhook resolving it concurrently). If the underlying tickets
 * already succeeded (a webhook landed between scan and processing), resolve
 * the session as "purchased" instead of destroying a payment that actually
 * went through.
 */
const expireCheckoutSessionById = async (sessionId, now) => {
  const session = await CheckoutSession.findOne({
    _id: sessionId,
    status: "reserved",
    expiresAt: { $lte: now },
  });

  if (!session) {
    return;
  }

  const tickets = session.ticketIds.length
    ? await EventTicket.find({ _id: { $in: session.ticketIds } })
    : [];

  const anyPaid = tickets.some(
    (ticket) => ticket.status === "paid" || ticket.status === "used",
  );

  if (anyPaid) {
    session.status = "purchased";
    session.purchasedAt = session.purchasedAt || now;
    await session.save();
    return;
  }

  await EventTicket.updateMany(
    { _id: { $in: session.ticketIds }, status: "pending" },
    {
      $set: {
        status: "cancelled",
        cancelledAt: now,
        "paymentMetadata.cancelReason": "checkout_session_expired",
      },
    },
  );

  session.status = "expired";
  await session.save();
};

const runCheckoutSessionMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const now = new Date();

    const stale = await CheckoutSession.find({
      status: "reserved",
      expiresAt: { $lte: now },
    })
      .select("_id")
      .sort({ expiresAt: 1 })
      .limit(200)
      .lean();

    for (const item of stale) {
      await expireCheckoutSessionById(item._id, now);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[CheckoutSessionMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startCheckoutSessionMonitor = () => {
  if (intervalHandle || !env.checkoutSessionMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runCheckoutSessionMonitorTick();
  }, env.checkoutSessionMonitorTickMs);

  void runCheckoutSessionMonitorTick();

  // eslint-disable-next-line no-console
  console.log(
    `[CheckoutSessionMonitor] Started (tick=${env.checkoutSessionMonitorTickMs}ms)`,
  );
};

const stopCheckoutSessionMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startCheckoutSessionMonitor,
  stopCheckoutSessionMonitor,
  runCheckoutSessionMonitorTick,
  expireCheckoutSessionById,
};
