const env = require("../config/env");
const ResaleSale = require("../models/resale-sale.model");
const PayoutAccount = require("../models/payout-account.model");
const Event = require("../models/event.model");
const { initiatePaystackTransfer, verifyPaystackTransfer } = require("./paystack.service");
const { returnPaystackPayment, readPaystackError } = require("./payment-refund.service");
const { createNotification } = require("./notification.service");

const HOUR_MS = 60 * 60 * 1000;
/* After this many failed transfers a payout stops retrying and waits for a
   person; the seller still sees it as owed. */
const MAX_TRANSFER_ATTEMPTS = 5;
/* A transfer with no webhook after this long is checked with Paystack
   directly (webhooks do not reach local and test setups). */
const RECONCILE_AFTER_MS = 10 * 60 * 1000;

const formatNaira = (kobo) => `₦${Math.round(Number(kobo || 0) / 100).toLocaleString("en-NG")}`;
const toId = (value) => String(value?._id || value || "");

/* Older payout accounts were saved without a bank name; fill it from the bank
   list. Required here, not at the top, because payout-account.service
   requires this file. */
const bankNameOf = async (account) => {
  if (account?.bankName) return account.bankName;
  const { resolveBankName } = require("./payout-account.service");
  return account?.bankCode ? resolveBankName(account.bankCode) : "";
};

const notify = (payload) => void createNotification({ push: true, ...payload }).catch(() => null);

/**
 * Records a paid resale, before the ticket moves. One record per payment
 * reference: if the verify call and the webhook both get here, the second
 * insert fails and that caller knows the sale is already being handled.
 *
 * Returns the new record, or null when this payment already has one.
 */
const claimResaleSale = async ({
  event,
  eventEndsAt,
  sourceTicket,
  buyerUserId,
  quantity,
  saleAmountNaira,
  paymentReference,
  paymentAttemptId,
}) => {
  /* The unique index on the payment reference is what makes this safe, so
     make sure it exists before relying on it (Mongo builds indexes in the
     background, and a fresh database may not have it yet). */
  await ResaleSale.init();

  const releaseAt = new Date(
    new Date(eventEndsAt || event.endsAt).getTime() + env.resalePayoutDelayHours * HOUR_MS,
  );

  try {
    return await ResaleSale.create({
      eventId: event._id,
      sourceTicketId: sourceTicket._id,
      ticketId: sourceTicket._id,
      sellerUserId: toId(sourceTicket.buyerUserId),
      buyerUserId,
      quantity,
      amountKobo: Math.round(saleAmountNaira * 100),
      resalePaymentReference: paymentReference,
      paymentAttemptId: paymentAttemptId || null,
      sellerPaymentReference: String(sourceTicket.paymentReference || ""),
      sellerPaidKobo: Math.max(0, Math.round(Number(sourceTicket.unitPriceNaira || 0) * quantity * 100)),
      releaseAt,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return null;
    }
    throw error;
  }
};

const markPaid = async (sale) => {
  const updated = await ResaleSale.findOneAndUpdate(
    { _id: sale._id, status: "processing" },
    { $set: { status: "paid", paidAt: new Date(), lastError: "" } },
    { new: true },
  );

  if (updated) {
    notify({
      userId: updated.sellerUserId,
      type: "ticket.resale.payout_paid",
      title: "Your resale money is on its way",
      message: `${formatNaira(updated.amountKobo)} was sent to ${updated.paidToBankName || "your bank"}${
        updated.paidToAccountLast4 ? ` ••${updated.paidToAccountLast4}` : ""
      }.`,
      data: { target: "resale-earnings", eventId: toId(updated.eventId) },
    });
  }

  return updated;
};

const markFailed = (sale, reason) =>
  ResaleSale.updateOne(
    { _id: sale._id, status: "processing" },
    { $set: { status: "failed", lastError: String(reason || "Transfer failed").slice(0, 500) } },
  );

/** Sends one due payout to the seller's bank, if they have one on file. */
const payOutSale = async (sale, now) => {
  const account = await PayoutAccount.findOne({ organizerUserId: sale.sellerUserId });

  if (!account || account.kycStatus !== "verified" || !account.paystackRecipientCode) {
    if (sale.status !== "awaiting_account") {
      const moved = await ResaleSale.findOneAndUpdate(
        { _id: sale._id, status: sale.status },
        { $set: { status: "awaiting_account" } },
        { new: true },
      );

      if (moved) {
        notify({
          userId: moved.sellerUserId,
          type: "ticket.resale.payout_needs_account",
          title: "Add your bank to get paid",
          message: `${formatNaira(moved.amountKobo)} from your resale is ready. Add your bank details and we'll send it.`,
          data: { target: "resale-earnings", eventId: toId(moved.eventId) },
        });
      }
    }
    return;
  }

  const attempt = Number(sale.transferAttempts || 0) + 1;
  const reference = `vera_resale_${sale._id}_${attempt}`;

  /* The claim is what stops two ticks paying the same sale. */
  const claimed = await ResaleSale.findOneAndUpdate(
    { _id: sale._id, status: sale.status },
    {
      $set: {
        status: "processing",
        transferReference: reference,
        transferStartedAt: now,
        lastError: "",
        paidToBankName: await bankNameOf(account),
        paidToAccountLast4: String(account.accountNumber || "").slice(-4),
      },
      $inc: { transferAttempts: 1 },
    },
    { new: true },
  );

  if (!claimed) {
    return;
  }

  try {
    const transfer = await initiatePaystackTransfer({
      amountKobo: claimed.amountKobo,
      recipientCode: account.paystackRecipientCode,
      reference,
      reason: "Vera ticket resale",
    });

    await ResaleSale.updateOne(
      { _id: claimed._id },
      { $set: { transferCode: String(transfer?.transfer_code || "") } },
    );

    if (String(transfer?.status || "").toLowerCase() === "success") {
      await markPaid(claimed);
    }
  } catch (error) {
    const { code, message } = readPaystackError(error);

    /* No answer from Paystack means the transfer may or may not exist. Leave
       it processing so reconciliation asks Paystack, rather than sending a
       second transfer that could pay twice. */
    if (!code && error?.message === "Could not reach Paystack") {
      await ResaleSale.updateOne({ _id: claimed._id }, { $set: { lastError: message } });
      return;
    }

    await markFailed(claimed, message);
  }
};

/** Asks Paystack about transfers whose webhook never came. */
const reconcileProcessingSales = async (now) => {
  const stale = await ResaleSale.find({
    status: "processing",
    transferStartedAt: { $lte: new Date(now.getTime() - RECONCILE_AFTER_MS) },
  }).limit(50);

  for (const sale of stale) {
    try {
      const transfer = await verifyPaystackTransfer(sale.transferReference);
      const status = String(transfer?.status || "").toLowerCase();

      if (status === "success") {
        await markPaid(sale);
      } else if (["failed", "reversed", "abandoned", "rejected"].includes(status)) {
        await markFailed(sale, `Paystack reported ${status}`);
      }
    } catch (error) {
      const { code, message } = readPaystackError(error);
      /* Paystack has never heard of it: it was never created, so it is safe
         to try again with a new reference. */
      if (code === "transfer_not_found" || /not found/i.test(message)) {
        await markFailed(sale, "Transfer was never created");
      }
    }
  }
};

/**
 * Pays out every sale whose hold has ended. Safe to run as often as wanted:
 * each sale is claimed before any money moves.
 */
const releaseDueResaleSales = async ({ now = new Date(), sellerUserId } = {}) => {
  await reconcileProcessingSales(now);

  const due = await ResaleSale.find({
    releaseAt: { $lte: now },
    ...(sellerUserId ? { sellerUserId } : {}),
    $or: [
      { status: { $in: ["held", "awaiting_account"] } },
      { status: "failed", transferAttempts: { $lt: MAX_TRANSFER_ATTEMPTS } },
    ],
  }).limit(100);

  const cancelledEventIds = new Set(
    (
      await Event.find({ _id: { $in: due.map((sale) => sale.eventId) }, status: "cancelled" })
        .select("_id")
        .lean()
    ).map((event) => String(event._id)),
  );

  for (const sale of due) {
    if (cancelledEventIds.has(String(sale.eventId))) {
      continue; // The cancellation sweep owns these.
    }
    try {
      await payOutSale(sale, now);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[ResalePayout] Payout failed", { saleId: String(sale._id), reason: readPaystackError(error).message });
    }
  }
};

/** Paystack webhook: transfer.success for one of our resale payouts. */
const finalizeResalePayoutSuccess = async ({ paystackReference }) => {
  const sale = await ResaleSale.findOne({ transferReference: paystackReference });
  return sale ? markPaid(sale) : null;
};

/** Paystack webhook: transfer.failed / transfer.reversed. Retried next tick. */
const finalizeResalePayoutFailure = async ({ paystackReference, reason }) => {
  const sale = await ResaleSale.findOne({ transferReference: paystackReference });
  if (sale) {
    await markFailed(sale, reason);
  }
};

const isResalePayoutReference = (reference) => String(reference || "").startsWith("vera_resale_");

/**
 * The event was cancelled: nothing is paid out, the buyer is refunded by the
 * ticket sweep, and the seller gets back what they paid for the tickets they
 * sold (the organizer kept that money for an event that isn't happening).
 */
const cancelResaleSalesForEvent = async (event) => {
  const sales = await ResaleSale.find({
    eventId: event._id,
    status: { $in: ["held", "awaiting_account", "failed"] },
  });

  for (const sale of sales) {
    const claimed = await ResaleSale.findOneAndUpdate(
      { _id: sale._id, status: sale.status },
      { $set: { status: "cancelled", cancelledAt: new Date() } },
      { new: true },
    );

    if (!claimed) {
      continue;
    }

    if (!claimed.sellerPaymentReference || claimed.sellerPaidKobo <= 0) {
      continue;
    }

    try {
      const { outcome } = await returnPaystackPayment({
        reference: claimed.sellerPaymentReference,
        amountKobo: claimed.sellerPaidKobo,
      });

      await ResaleSale.updateOne(
        { _id: claimed._id },
        {
          $set: {
            sellerRefund: {
              status: "refunded",
              method: outcome === "no_provider_payment" ? "none" : "paystack",
              at: new Date(),
              error: "",
            },
          },
        },
      );

      notify({
        userId: claimed.sellerUserId,
        type: "ticket.resale.cancelled_refund",
        title: "Event cancelled",
        message: `The event was cancelled, so your resale is off. ${formatNaira(claimed.sellerPaidKobo)} you paid for the ticket is being refunded.`,
        data: { target: "resale-earnings", eventId: toId(claimed.eventId) },
      });
    } catch (error) {
      await ResaleSale.updateOne(
        { _id: claimed._id },
        {
          $set: {
            sellerRefund: { status: "failed", method: "", at: new Date(), error: readPaystackError(error).message },
          },
        },
      );
    }
  }

  /* Paid out before the cancellation (only possible if an event is cancelled
     more than a day after it ended): left for a person to sort out. */
  const alreadyPaid = await ResaleSale.countDocuments({
    eventId: event._id,
    status: { $in: ["processing", "paid"] },
  });
  if (alreadyPaid) {
    // eslint-disable-next-line no-console
    console.warn("[ResalePayout] Event cancelled after resale payouts went out", {
      eventId: String(event._id),
      count: alreadyPaid,
    });
  }
};

/** The seller's own view: every sale, and what is owed, waiting or paid. */
const listMyResaleSales = async ({ sellerUserId }) => {
  const [sales, account] = await Promise.all([
    ResaleSale.find({ sellerUserId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("eventId", "name imageUrl startsAt endsAt status")
      .lean(),
    PayoutAccount.findOne({ organizerUserId: sellerUserId }).select("bankName bankCode accountNumber kycStatus").lean(),
  ]);
  const bankName = account ? await bankNameOf(account) : "";

  const sum = (statuses) =>
    sales.filter((sale) => statuses.includes(sale.status)).reduce((total, sale) => total + sale.amountKobo, 0);

  return {
    payoutAccount:
      account && account.kycStatus === "verified"
        ? { bankName, accountLast4: String(account.accountNumber || "").slice(-4) }
        : null,
    payoutDelayHours: env.resalePayoutDelayHours,
    summary: {
      pendingKobo: sum(["held", "processing", "failed"]),
      awaitingAccountKobo: sum(["awaiting_account"]),
      paidKobo: sum(["paid"]),
    },
    items: sales.map((sale) => ({
      _id: String(sale._id),
      status: sale.status,
      amountKobo: sale.amountKobo,
      quantity: sale.quantity,
      releaseAt: sale.releaseAt,
      paidAt: sale.paidAt,
      cancelledAt: sale.cancelledAt,
      paidToBankName: sale.paidToBankName,
      paidToAccountLast4: sale.paidToAccountLast4,
      sellerRefund: sale.sellerRefund,
      sellerPaidKobo: sale.sellerPaidKobo,
      createdAt: sale.createdAt,
      event:
        sale.eventId && typeof sale.eventId === "object"
          ? {
              _id: String(sale.eventId._id),
              name: sale.eventId.name,
              imageUrl: sale.eventId.imageUrl || "",
              startsAt: sale.eventId.startsAt,
              status: sale.eventId.status,
            }
          : null,
    })),
  };
};

module.exports = {
  MAX_TRANSFER_ATTEMPTS,
  claimResaleSale,
  releaseDueResaleSales,
  finalizeResalePayoutSuccess,
  finalizeResalePayoutFailure,
  isResalePayoutReference,
  cancelResaleSalesForEvent,
  listMyResaleSales,
};
