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
 * bypass issuance path in initializeTicketPurchase. Both must pass a
 * session so the wallet writes commit atomically with the ticket write.
 *
 * Idempotency: checked via a pre-check read BEFORE attempting any write,
 * not a catch-after-insert. MongoDB transactions can't "catch and continue"
 * past a failed write. Any operation error poisons the whole transaction
 * for commit even if the app catches the rejection, so a genuine
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

  // Informational fee line only, already netted into the ticket_sale
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

/**
 * Credits one add-on line. Deliberately its own ledger row and its own
 * idempotency key: a refund looks a ticket's sale up by ticketId, and every
 * add-on shares its ticket's id, so folding these into ticket_sale would make
 * a refund reverse the wrong amount.
 */
const creditAddOnSale = async ({ purchase, session, event: providedEvent = null }) => {
  const idempotencyKey = `add_on_sale:${purchase._id}`;
  const alreadyCredited = await WalletTransaction.exists({ idempotencyKey }).session(
    session,
  );

  if (alreadyCredited) {
    return;
  }

  const pricingBreakdown = purchase?.pricingBreakdown;

  if (!pricingBreakdown) {
    throw new ApiError(
      500,
      "Add-on is missing a pricing breakdown for wallet credit",
      { addOnPurchaseId: purchase?._id },
    );
  }

  const event =
    providedEvent || (await Event.findById(purchase.eventId).session(session));

  if (!event) {
    throw new ApiError(500, "Event not found while crediting wallet", {
      addOnPurchaseId: purchase._id,
      eventId: purchase.eventId,
    });
  }

  const organizer = await User.findById(purchase.organizerUserId)
    .select("payoutTier")
    .session(session);
  const tierDelayHours = getSettlementDelayHours(organizer?.payoutTier);
  const settlementEligibleAt = new Date(
    new Date(event.endsAt).getTime() + tierDelayHours * 60 * 60 * 1000,
  );

  const wallet = await getOrCreateWallet(purchase.organizerUserId, session);
  const saleAmountKobo = nairaToKobo(pricingBreakdown.organizerNetNaira);
  const feeAmountKobo = nairaToKobo(pricingBreakdown.veraFeeNaira);

  const [saleTransaction] = await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: purchase.organizerUserId,
        type: "add_on_sale",
        amountKobo: saleAmountKobo,
        bucket: "pending",
        status: "pending_settlement",
        settlementEligibleAt,
        eventId: purchase.eventId,
        ticketId: purchase.ticketId,
        idempotencyKey,
        description: `${purchase.name} sold with a ticket`,
        metadata: {
          pricingBreakdown,
          addOnPurchaseId: String(purchase._id),
          addOnName: purchase.name,
          variantName: purchase.variantName || "",
        },
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

  await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: purchase.organizerUserId,
        type: "platform_fee",
        amountKobo: -feeAmountKobo,
        bucket: "pending",
        status: "completed",
        eventId: purchase.eventId,
        ticketId: purchase.ticketId,
        sourceTransactionId: saleTransaction._id,
        idempotencyKey: `platform_fee:add_on:${purchase._id}`,
        description: "Vera platform fee for this add-on",
      },
    ],
    { session },
  );
};

/**
 * Credits the difference a holder paid to move up a tier. Its own row and its
 * own key: the ticket already carries a `ticket_sale` credit for what it
 * originally cost, and a refund looks that one up by ticketId.
 */
const creditTicketUpgrade = async ({ ticket, pricingBreakdown, session, event: providedEvent = null }) => {
  const idempotencyKey = `ticket_upgrade:${ticket._id}:${ticket.paymentReference || "none"}`;
  const alreadyCredited = await WalletTransaction.exists({ idempotencyKey }).session(
    session,
  );

  if (alreadyCredited) {
    return;
  }

  if (!pricingBreakdown) {
    throw new ApiError(500, "Upgrade is missing a pricing breakdown", {
      ticketId: ticket?._id,
    });
  }

  const event =
    providedEvent || (await Event.findById(ticket.eventId).session(session));

  if (!event) {
    throw new ApiError(500, "Event not found while crediting an upgrade", {
      ticketId: ticket._id,
    });
  }

  const organizer = await User.findById(ticket.organizerUserId)
    .select("payoutTier")
    .session(session);
  const settlementEligibleAt = new Date(
    new Date(event.endsAt).getTime() +
      getSettlementDelayHours(organizer?.payoutTier) * 60 * 60 * 1000,
  );

  const wallet = await getOrCreateWallet(ticket.organizerUserId, session);
  const saleAmountKobo = nairaToKobo(pricingBreakdown.organizerNetNaira);
  const feeAmountKobo = nairaToKobo(pricingBreakdown.veraFeeNaira);

  const [saleTransaction] = await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: ticket.organizerUserId,
        type: "ticket_upgrade",
        amountKobo: saleAmountKobo,
        bucket: "pending",
        status: "pending_settlement",
        settlementEligibleAt,
        eventId: ticket.eventId,
        ticketId: ticket._id,
        idempotencyKey,
        description: "Tier upgrade credited to pending balance",
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
        idempotencyKey: `platform_fee:upgrade:${ticket._id}:${ticket.paymentReference || "none"}`,
        description: "Vera platform fee for this upgrade",
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

/**
 * Releases one collected vendor order into the vendor's wallet.
 *
 * Organizers earn from vendors through the stall fee alone, so an order is
 * one credit and one fee line. Called only when an order reaches
 * `collected`, which is what makes the hold real — money that was taken from
 * the buyer at checkout sits with Vera until the food is handed over.
 *
 * A vendor's wallet is the same OrganizerWallet everyone else uses, keyed by
 * the user who owns the vendor. The field is named organizerUserId for
 * history; it has always meant "the user this wallet belongs to", and reusing
 * it means settlement, payouts and withdrawals already work for vendors.
 */
const creditVendorOrder = async ({ order, session, event: providedEvent = null }) => {
  const event =
    providedEvent || (await Event.findById(order.eventId).session(session));

  if (!event) {
    throw new ApiError(500, "Event not found while crediting a vendor order", {
      orderId: order?._id,
    });
  }

  const settlementFor = async (userId) => {
    const owner = await User.findById(userId).select("payoutTier").session(session);

    return new Date(
      new Date(event.endsAt).getTime() +
        getSettlementDelayHours(owner?.payoutTier) * 60 * 60 * 1000,
    );
  };

  const credit = async ({ userId, type, amountNaira, description, feeKobo = 0 }) => {
    const amountKobo = nairaToKobo(amountNaira);

    if (amountKobo <= 0) {
      return;
    }

    const idempotencyKey = `${type}:${order._id}`;

    if (await WalletTransaction.exists({ idempotencyKey }).session(session)) {
      return;
    }

    const wallet = await getOrCreateWallet(userId, session);

    const [created] = await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          organizerUserId: userId,
          type,
          amountKobo,
          bucket: "pending",
          status: "pending_settlement",
          settlementEligibleAt: await settlementFor(userId),
          eventId: order.eventId,
          vendorOrderId: order._id,
          idempotencyKey,
          description,
          metadata: { pricing: order.pricing },
        },
      ],
      { session },
    );

    await OrganizerWallet.updateOne(
      { _id: wallet._id },
      {
        $inc: {
          pendingBalanceKobo: amountKobo,
          lifetimeGrossSalesKobo: amountKobo,
          lifetimePlatformFeesKobo: feeKobo,
          version: 1,
        },
      },
      { session },
    );

    if (feeKobo > 0) {
      /* Informational only: already netted out of the credit above, so it
         must not touch a balance a second time. */
      await WalletTransaction.create(
        [
          {
            walletId: wallet._id,
            organizerUserId: userId,
            type: "platform_fee",
            amountKobo: -feeKobo,
            bucket: "pending",
            status: "completed",
            eventId: order.eventId,
            vendorOrderId: order._id,
            sourceTransactionId: created._id,
            idempotencyKey: `platform_fee:vendor_order:${order._id}`,
            description: "Vera fee on this order",
          },
        ],
        { session },
      );
    }
  };

  await credit({
    userId: order.vendorUserId,
    type: "vendor_order_sale",
    amountNaira: order.pricing.vendorNetNaira,
    description: "Order collected, net of fees",
    feeKobo: nairaToKobo(order.pricing.veraFeeNaira),
  });

};

/**
 * Credits an organizer the stall fee a vendor just paid.
 *
 * Settles on the same clock as everything else for that event, so a stall fee
 * and the ticket money it sits beside become available together.
 */
const creditStallFee = async ({ booking, event, session }) => {
  const amountKobo = nairaToKobo(booking.terms?.stallFeeNaira);

  if (amountKobo <= 0) {
    return;
  }

  const idempotencyKey = `vendor_stall_fee:${booking._id}`;

  if (await WalletTransaction.exists({ idempotencyKey }).session(session)) {
    return;
  }

  const organizer = await User.findById(event.organizerUserId)
    .select("payoutTier")
    .session(session);
  const settlementEligibleAt = new Date(
    new Date(event.endsAt).getTime() +
      getSettlementDelayHours(organizer?.payoutTier) * 60 * 60 * 1000,
  );

  const wallet = await getOrCreateWallet(event.organizerUserId, session);

  await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        organizerUserId: event.organizerUserId,
        type: "vendor_stall_fee",
        amountKobo,
        bucket: "pending",
        status: "pending_settlement",
        settlementEligibleAt,
        eventId: event._id,
        idempotencyKey,
        description: "Stall fee from a vendor",
      },
    ],
    { session },
  );

  await OrganizerWallet.updateOne(
    { _id: wallet._id },
    {
      $inc: {
        pendingBalanceKobo: amountKobo,
        lifetimeGrossSalesKobo: amountKobo,
        version: 1,
      },
    },
    { session },
  );
};

module.exports = {
  nairaToKobo,
  buildPaginationMeta,
  getOrCreateWallet,
  creditTicketSale,
  creditAddOnSale,
  creditTicketUpgrade,
  creditVendorOrder,
  creditStallFee,
  getWalletSummary,
  listWalletTransactions,
  getWalletTransactionById,
};
