const ApiError = require("../utils/api-error");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const { getSettlementDelayHours } = require("../config/payout-tiers");

const nairaToKobo = (naira) => Math.round(Number(naira || 0) * 100);

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

/**
 * Atomic upsert-or-fetch. A unique index on organizerUserId means a rare
 * concurrent first-credit race just surfaces as a retryable write conflict
 * (or a duplicate-key error from the losing side of the upsert), not a
 * duplicate wallet.
 */
const getOrCreateWallet = async (organizerUserId, session = null) =>
  OrganizerWallet.findOneAndUpdate(
    { organizerUserId },
    { $setOnInsert: { organizerUserId } },
    { upsert: true, new: true, session },
  );

/**
 * Credits an organizer's wallet for one paid ticket. Called from both
 * finalizeTicketPurchasePayment (paid tickets) and the instant free/dev-
 * bypass issuance path in initializeTicketPurchase — both must pass a
 * session so the wallet writes commit atomically with the ticket write.
 *
 * Idempotency: checked via a pre-check read BEFORE attempting any write,
 * not a catch-after-insert. MongoDB transactions can't "catch and continue"
 * past a failed write — any operation error poisons the whole transaction
 * for commit even if the app catches the rejection — so a genuine
 * simultaneous race (verify + webhook both passing the pre-check before
 * either commits) still throws here, but that's fine: it aborts this
 * attempt and withMongoTransaction's caller retries with a fresh
 * transaction, whose pre-check will then see the now-committed row and
 * return cleanly.
 */
const creditTicketSale = async ({ ticket, session, event: providedEvent = null }) => {
  const idempotencyKey = `ticket_sale:${ticket._id}`;
  const alreadyCredited = await WalletTransaction.exists({ idempotencyKey }).session(
    session,
  );

  if (alreadyCredited) {
    return;
  }

  const pricingBreakdown = ticket?.paymentMetadata?.pricingBreakdown;

  if (!pricingBreakdown) {
    throw new ApiError(
      500,
      "Ticket is missing a pricing breakdown for wallet credit",
      { ticketId: ticket?._id },
    );
  }

  const event =
    providedEvent || (await Event.findById(ticket.eventId).session(session));

  if (!event) {
    throw new ApiError(500, "Event not found while crediting wallet", {
      ticketId: ticket._id,
      eventId: ticket.eventId,
    });
  }

  const organizer = await User.findById(ticket.organizerUserId)
    .select("payoutTier")
    .session(session);
  const tierDelayHours = getSettlementDelayHours(organizer?.payoutTier);
  const settlementEligibleAt = new Date(
    new Date(event.endsAt).getTime() + tierDelayHours * 60 * 60 * 1000,
  );

  const wallet = await getOrCreateWallet(ticket.organizerUserId, session);

  const saleAmountKobo = nairaToKobo(pricingBreakdown.organizerNetNaira);
  const feeAmountKobo = nairaToKobo(pricingBreakdown.veraFeeNaira);

  const [saleTransaction] = await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: ticket.organizerUserId,
        type: "ticket_sale",
        amountKobo: saleAmountKobo,
        bucket: "pending",
        status: "pending_settlement",
        settlementEligibleAt,
        eventId: ticket.eventId,
        ticketId: ticket._id,
        idempotencyKey,
        description: "Ticket sale credited to pending balance",
        metadata: { pricingBreakdown },
      },
    ],
    { session },
  );

  await OrganizerWallet.updateOne(
    { _id: wallet._id },
    {
      $inc: {
        pendingBalanceKobo: saleAmountKobo,
        lifetimeGrossSalesKobo: nairaToKobo(pricingBreakdown.basePriceNaira),
        lifetimePlatformFeesKobo: feeAmountKobo,
        version: 1,
      },
    },
    { session },
  );

  // Informational fee line only — already netted into the ticket_sale
  // credit above, so this does not touch pendingBalanceKobo again.
  await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: ticket.organizerUserId,
        type: "platform_fee",
        amountKobo: -feeAmountKobo,
        bucket: "pending",
        status: "completed",
        eventId: ticket.eventId,
        ticketId: ticket._id,
        sourceTransactionId: saleTransaction._id,
        idempotencyKey: `platform_fee:${ticket._id}`,
        description: "Vera platform fee for this sale",
      },
    ],
    { session },
  );
};

const getWalletSummary = async (organizerUserId) =>
  getOrCreateWallet(organizerUserId);

const listWalletTransactions = async ({
  organizerUserId,
  type = "all",
  page = 1,
  limit = 20,
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
  const query = { organizerUserId };

  if (type && type !== "all") {
    query.type = type;
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    WalletTransaction.find(query)
      .populate("eventId", "name imageUrl address startsAt")
      .populate("ticketId", "ticketCode attendeeName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),
    WalletTransaction.countDocuments(query),
  ]);

  return {
    items,
    ...buildPaginationMeta({ page: pageNumber, limit: limitNumber, totalItems }),
  };
};

const getWalletTransactionById = async ({ transactionId, organizerUserId }) => {
  const transaction = await WalletTransaction.findById(transactionId)
    .populate("eventId", "name imageUrl address startsAt endsAt")
    .populate("ticketId", "ticketCode attendeeName");

  if (!transaction) {
    throw new ApiError(404, "Transaction not found");
  }

  if (String(transaction.organizerUserId) !== String(organizerUserId)) {
    throw new ApiError(403, "You cannot view this transaction");
  }

  return transaction;
};

module.exports = {
  nairaToKobo,
  buildPaginationMeta,
  getOrCreateWallet,
  creditTicketSale,
  getWalletSummary,
  listWalletTransactions,
  getWalletTransactionById,
};
