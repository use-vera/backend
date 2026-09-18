const ApiError = require("../utils/api-error");
const PromoCodeRedemption = require("../models/promo-code-redemption.model");
const {
  computePromoDiscountNaira,
} = require("./pricing.service");

/* Matches the ticket and add-on rule: an abandoned checkout lets go of what
   it was holding after thirty minutes rather than sitting on it forever. */
const PENDING_HOLD_MS = 30 * 60 * 1000;

const normalizeCodeText = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const findPromoCode = (event, code) => {
  const wanted = normalizeCodeText(code);

  if (!wanted) {
    return null;
  }

  return (
    (event.promoCodes || []).find(
      (promoCode) => normalizeCodeText(promoCode.code) === wanted,
    ) || null
  );
};

/**
 * Uses that are still live: confirmed ones, plus reservations from checkouts
 * that have not yet been abandoned. A dropped payment must not keep a code
 * off the shelf.
 */
const countLiveRedemptions = async ({ promoCodeId, buyerUserId = null }) => {
  const query = {
    promoCodeId,
    $or: [
      { status: "confirmed" },
      {
        status: "reserved",
        createdAt: { $gte: new Date(Date.now() - PENDING_HOLD_MS) },
      },
    ],
  };

  if (buyerUserId) {
    query.buyerUserId = buyerUserId;
  }

  return PromoCodeRedemption.countDocuments(query);
};

/**
 * The organizer's own view of a code: what it is, and what it has cost them
 * so far. "Given away" is the number an organizer wants and never has.
 */
const describePromoCodes = async ({ event }) => {
  const promoCodes = event.promoCodes || [];

  return Promise.all(
    promoCodes.map(async (promoCode) => {
      const [usedCount, confirmed] = await Promise.all([
        countLiveRedemptions({ promoCodeId: promoCode._id }),
        PromoCodeRedemption.aggregate([
          { $match: { promoCodeId: promoCode._id, status: "confirmed" } },
          {
            $group: {
              _id: null,
              discountNaira: { $sum: "$discountNaira" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const maxUses = Number(promoCode.maxUses || 0);

      return {
        _id: String(promoCode._id),
        name: promoCode.name,
        code: normalizeCodeText(promoCode.code),
        discountType: promoCode.discountType || "percent",
        discountValue: Number(promoCode.discountValue || 0),
        appliesTo: promoCode.appliesTo || "ticket",
        maxUses,
        perUserLimit: Number(promoCode.perUserLimit || 1),
        endsAt: promoCode.endsAt || null,
        active: promoCode.active !== false,
        usedCount,
        remainingUses: maxUses > 0 ? Math.max(0, maxUses - usedCount) : null,
        givenAwayNaira: Number(confirmed[0]?.discountNaira || 0),
        paidUseCount: Number(confirmed[0]?.count || 0),
      };
    }),
  );
};

/**
 * Turns organizer input into storable codes.
 *
 * Two codes reading the same on an event is the one thing that cannot be
 * allowed: a buyer types a code, not an id, so a duplicate makes the
 * discount ambiguous at checkout.
 */
const normalizePromoCodesInput = (promoCodes = []) => {
  if (!Array.isArray(promoCodes)) {
    return [];
  }

  const seen = new Set();

  return promoCodes.map((promoCode) => {
    const code = normalizeCodeText(promoCode.code);

    if (seen.has(code)) {
      throw new ApiError(400, `You already have a code called ${code}`);
    }

    seen.add(code);

    const discountType = promoCode.discountType === "fixed" ? "fixed" : "percent";
    const discountValue = Math.round(Number(promoCode.discountValue || 0));

    if (discountType === "percent" && discountValue > 100) {
      throw new ApiError(400, `${code} cannot take off more than 100%`);
    }

    return {
      ...(promoCode._id ? { _id: promoCode._id } : {}),
      name: String(promoCode.name || "").trim(),
      code,
      discountType,
      discountValue,
      appliesTo: promoCode.appliesTo === "addons" ? "addons" : "ticket",
      maxUses: Math.max(0, Math.round(Number(promoCode.maxUses || 0))),
      perUserLimit: Math.max(1, Math.round(Number(promoCode.perUserLimit || 1))),
      endsAt: promoCode.endsAt ? new Date(promoCode.endsAt) : null,
      active: promoCode.active !== false,
    };
  });
};

/**
 * Decides what a typed code is worth on this particular order.
 *
 * Every refusal is a separate, named error: "we don't know that code" and
 * "you have already used that code" are different problems for the person
 * typing, and the client shows different things for each.
 *
 * An add-on code against an order with no add-ons is deliberately NOT a
 * refusal. The code is good — it simply has nothing to come off yet — so it
 * comes back as `needsAddOn` and the client asks the buyer to pick one.
 */
const resolvePromoCodeForCheckout = async ({
  event,
  code,
  buyerUserId,
  ticketPricing,
  addOnPricings = [],
  now = new Date(),
}) => {
  const wanted = normalizeCodeText(code);

  if (!wanted) {
    return null;
  }

  const promoCode = findPromoCode(event, wanted);

  if (!promoCode || promoCode.active === false) {
    throw new ApiError(
      404,
      "We don’t recognise that code.",
      null,
      "PROMO_CODE_UNKNOWN",
    );
  }

  if (promoCode.endsAt && new Date(promoCode.endsAt) <= now) {
    throw new ApiError(
      409,
      "That code has expired.",
      null,
      "PROMO_CODE_EXPIRED",
    );
  }

  /* Asked in this order deliberately: someone who has used their own
     allowance should be told that, not that the code ran out. */
  const perUserLimit = Math.max(1, Number(promoCode.perUserLimit || 1));
  const usedByBuyer = await countLiveRedemptions({
    promoCodeId: promoCode._id,
    buyerUserId,
  });

  if (usedByBuyer >= perUserLimit) {
    throw new ApiError(
      409,
      perUserLimit === 1
        ? "You have already used that code."
        : `You have already used that code ${perUserLimit} times.`,
      null,
      "PROMO_CODE_ALREADY_USED",
    );
  }

  const maxUses = Number(promoCode.maxUses || 0);

  if (maxUses > 0) {
    const used = await countLiveRedemptions({ promoCodeId: promoCode._id });

    if (used >= maxUses) {
      throw new ApiError(
        409,
        "That code has been fully used.",
        null,
        "PROMO_CODE_USED_UP",
      );
    }
  }

  const appliesTo = promoCode.appliesTo === "addons" ? "addons" : "ticket";
  const addOnsCheckoutNaira = addOnPricings.reduce(
    (sum, line) => sum + Number(line.totalCheckoutNaira || 0),
    0,
  );
  const discountableNaira =
    appliesTo === "addons"
      ? addOnsCheckoutNaira
      : Number(ticketPricing?.totalCheckoutNaira || 0);

  /* The code is fine; the order just has nothing for it to come off. The
     caller turns this into a prompt, not an error. */
  if (appliesTo === "addons" && addOnsCheckoutNaira <= 0) {
    return {
      promoCode,
      appliesTo,
      discountNaira: 0,
      needsAddOn: true,
    };
  }

  const discountNaira = computePromoDiscountNaira({
    discountType: promoCode.discountType || "percent",
    discountValue: Number(promoCode.discountValue || 0),
    discountableNaira,
  });

  if (discountNaira <= 0) {
    throw new ApiError(
      409,
      "That code takes nothing off this order.",
      null,
      "PROMO_CODE_NO_EFFECT",
    );
  }

  return {
    promoCode,
    appliesTo,
    discountNaira,
    needsAddOn: false,
  };
};

/**
 * Holds one use of the code for this checkout. The row is only worth money
 * once the payment settles, which is what `confirmRedemptions` is for.
 *
 * Two checkouts racing the last use can both reserve it: the same accepted
 * oversell trade-off ticket and add-on stock already make, and the cost here
 * is one extra discount rather than a ticket that cannot be honoured.
 */
const reserveRedemption = async ({
  event,
  promoCode,
  appliesTo,
  discountNaira,
  buyerUserId,
  ticket,
  purchaseBatchId,
}) => {
  if (!promoCode || discountNaira <= 0) {
    return null;
  }

  return PromoCodeRedemption.create({
    eventId: event._id,
    promoCodeId: promoCode._id,
    code: normalizeCodeText(promoCode.code),
    buyerUserId,
    organizerUserId: event.organizerUserId,
    ticketId: ticket._id,
    purchaseBatchId,
    appliesTo,
    discountNaira,
    status: "reserved",
  });
};

/**
 * Lets go of what this buyer was holding on this event.
 *
 * Restarting a checkout cancels the previous pending order, so its hold has
 * to go with it — otherwise someone is blocked by their own abandoned
 * attempt and has to wait out the hold window to use a code they never used.
 */
const releaseBuyerReservations = async ({ eventId, buyerUserId, reason = "" }) => {
  const result = await PromoCodeRedemption.updateMany(
    { eventId, buyerUserId, status: "reserved" },
    {
      $set: {
        status: "released",
        releasedAt: new Date(),
        releaseReason: String(reason || "").slice(0, 120),
      },
    },
  );

  return Number(result.modifiedCount || 0);
};

/** The payment settled, so the use is spent for good. */
const confirmRedemptions = async ({ purchaseBatchId, session = null }) => {
  const batchId = String(purchaseBatchId || "").trim();

  if (!batchId) {
    return 0;
  }

  const result = await PromoCodeRedemption.updateMany(
    { purchaseBatchId: batchId, status: "reserved" },
    { $set: { status: "confirmed", confirmedAt: new Date() } },
    session ? { session } : {},
  );

  return Number(result.modifiedCount || 0);
};

/** The checkout died, so the use goes back on the shelf. */
const releaseRedemptions = async ({ purchaseBatchId, reason = "" }) => {
  const batchId = String(purchaseBatchId || "").trim();

  if (!batchId) {
    return 0;
  }

  const result = await PromoCodeRedemption.updateMany(
    { purchaseBatchId: batchId, status: "reserved" },
    {
      $set: {
        status: "released",
        releasedAt: new Date(),
        releaseReason: String(reason || "").slice(0, 120),
      },
    },
  );

  return Number(result.modifiedCount || 0);
};

module.exports = {
  PENDING_HOLD_MS,
  normalizeCodeText,
  findPromoCode,
  describePromoCodes,
  normalizePromoCodesInput,
  resolvePromoCodeForCheckout,
  reserveRedemption,
  releaseBuyerReservations,
  confirmRedemptions,
  releaseRedemptions,
};
