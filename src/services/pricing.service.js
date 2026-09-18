const DEFAULT_PLATFORM_FEE_PERCENT = 5;
const SUPPORTED_FEE_MODES = ["absorbed_by_organizer", "passed_to_attendee"];

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value)));

const normalizeEventFeeConfig = ({
  platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT,
  feeMode = "absorbed_by_organizer",
} = {}) => {
  const normalizedFeeMode = SUPPORTED_FEE_MODES.includes(String(feeMode))
    ? String(feeMode)
    : "absorbed_by_organizer";

  return {
    platformFeePercent: clamp(
      Number(platformFeePercent || DEFAULT_PLATFORM_FEE_PERCENT),
      0,
      100,
    ),
    feeMode: normalizedFeeMode,
  };
};

const computePrimaryTicketPricing = ({
  baseUnitPriceNaira = 0,
  quantity = 1,
  platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT,
  feeMode = "absorbed_by_organizer",
} = {}) => {
  const safeQuantity = Math.max(1, Math.round(Number(quantity || 1)));
  const safeBaseUnitPriceNaira = Math.max(
    0,
    Math.round(Number(baseUnitPriceNaira || 0)),
  );
  const normalized = normalizeEventFeeConfig({ platformFeePercent, feeMode });
  const unitVeraFeeNaira = Math.round(
    (safeBaseUnitPriceNaira * normalized.platformFeePercent) / 100,
  );

  const unitCheckoutPriceNaira =
    normalized.feeMode === "passed_to_attendee"
      ? safeBaseUnitPriceNaira + unitVeraFeeNaira
      : safeBaseUnitPriceNaira;
  const unitOrganizerNetNaira =
    normalized.feeMode === "passed_to_attendee"
      ? safeBaseUnitPriceNaira
      : Math.max(0, safeBaseUnitPriceNaira - unitVeraFeeNaira);

  const totalBasePriceNaira = safeBaseUnitPriceNaira * safeQuantity;
  const totalVeraFeeNaira = unitVeraFeeNaira * safeQuantity;
  const totalCheckoutNaira = unitCheckoutPriceNaira * safeQuantity;
  const organizerNetNaira = unitOrganizerNetNaira * safeQuantity;

  return {
    quantity: safeQuantity,
    feeMode: normalized.feeMode,
    platformFeePercent: normalized.platformFeePercent,
    unitBasePriceNaira: safeBaseUnitPriceNaira,
    unitVeraFeeNaira,
    unitCheckoutPriceNaira,
    unitOrganizerNetNaira,
    totalBasePriceNaira,
    totalVeraFeeNaira,
    totalCheckoutNaira,
    organizerNetNaira,
    basePriceNaira: totalBasePriceNaira,
    veraFeeNaira: totalVeraFeeNaira,
  };
};

/**
 * One add-on line, priced by exactly the rules a ticket uses.
 *
 * Deliberately a separate call rather than an extra branch inside
 * computePrimaryTicketPricing: that function's output is what the wallet
 * settles against, and its shape must not move. Each add-on line carries its
 * own breakdown and is credited on its own.
 */
const computeAddOnPricing = ({
  unitPriceNaira = 0,
  quantity = 1,
  platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT,
  feeMode = "absorbed_by_organizer",
} = {}) =>
  computePrimaryTicketPricing({
    baseUnitPriceNaira: unitPriceNaira,
    quantity,
    platformFeePercent,
    feeMode,
  });

/**
 * What a promo code takes off, in naira.
 *
 * Never more than the thing it applies to: a ₦5,000 code against ₦3,000 of
 * add-ons takes ₦3,000, not ₦5,000, so a code can discount an order but can
 * never pay money out of one.
 */
const computePromoDiscountNaira = ({
  discountType = "percent",
  discountValue = 0,
  discountableNaira = 0,
} = {}) => {
  const ceiling = Math.max(0, Math.round(Number(discountableNaira || 0)));

  if (ceiling <= 0) {
    return 0;
  }

  const raw =
    discountType === "fixed"
      ? Math.round(Number(discountValue || 0))
      : Math.round((ceiling * clamp(Number(discountValue || 0), 0, 100)) / 100);

  return Math.max(0, Math.min(ceiling, raw));
};

/**
 * The discount comes out of the organizer's side and nowhere else: the buyer
 * pays less, the organizer keeps less, and Vera's fee stays exactly where it
 * was — worked out on the full price. A code is the organizer's money to
 * give away, so it is the organizer's money that it costs.
 */
const withPromoDiscount = ({ pricing, discountNaira = 0 }) => {
  const discount = Math.max(
    0,
    Math.min(Math.round(Number(discountNaira || 0)), pricing.totalCheckoutNaira),
  );

  if (discount <= 0) {
    return { ...pricing, promoDiscountNaira: 0 };
  }

  return {
    ...pricing,
    promoDiscountNaira: discount,
    totalCheckoutNaira: pricing.totalCheckoutNaira - discount,
    organizerNetNaira: Math.max(0, pricing.organizerNetNaira - discount),
  };
};

/**
 * Splits one order-level discount across the order's tickets, remainder
 * first, so the parts always add back up to the whole. A ₦5,000 code over
 * three tickets is 1,667 + 1,667 + 1,666, never 3 × 1,666.
 */
const splitDiscountAcrossUnits = (discountNaira, quantity) => {
  const units = Math.max(1, Math.round(Number(quantity || 1)));
  const total = Math.max(0, Math.round(Number(discountNaira || 0)));
  const each = Math.floor(total / units);
  const remainder = total - each * units;

  return Array.from(
    { length: units },
    (_, index) => each + (index < remainder ? 1 : 0),
  );
};

/**
 * Spreads one discount across several priced lines, in proportion to what
 * each costs and never beyond it. Used for a code that comes off "add-ons"
 * as a whole: each line is credited net of its own share, so the organizer's
 * payout drops by exactly what the buyer saved.
 */
const splitDiscountAcrossAmounts = (discountNaira, amounts = []) => {
  const totals = amounts.map((amount) => Math.max(0, Math.round(Number(amount || 0))));
  const pool = totals.reduce((sum, amount) => sum + amount, 0);
  const total = Math.max(0, Math.min(Math.round(Number(discountNaira || 0)), pool));

  if (total <= 0 || pool <= 0) {
    return totals.map(() => 0);
  }

  const exact = totals.map((amount) => (amount * total) / pool);
  const shares = exact.map((value) => Math.floor(value));
  let remainder = total - shares.reduce((sum, value) => sum + value, 0);

  /* Largest fractional part first, so the parts add back up to the whole
     and the biggest line absorbs the odd naira. */
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const entry of order) {
    if (remainder <= 0) {
      break;
    }

    if (shares[entry.index] < totals[entry.index]) {
      shares[entry.index] += 1;
      remainder -= 1;
    }
  }

  return shares;
};

/**
 * One seat's own breakdown, which is what the wallet settles against.
 *
 * Every ticket row must carry the pricing for ITSELF: the wallet credits
 * each ticket from its stored breakdown, so storing the whole order's
 * figures on every row would pay the organizer for the order once per
 * ticket in it.
 */
const buildSeatPricing = ({ pricing, seatDiscountNaira = 0 }) => {
  const discount = Math.max(
    0,
    Math.min(
      Math.round(Number(seatDiscountNaira || 0)),
      pricing.unitCheckoutPriceNaira,
    ),
  );
  const unitCheckoutPriceNaira = pricing.unitCheckoutPriceNaira - discount;
  const unitOrganizerNetNaira = Math.max(
    0,
    pricing.unitOrganizerNetNaira - discount,
  );

  return {
    quantity: 1,
    feeMode: pricing.feeMode,
    platformFeePercent: pricing.platformFeePercent,
    unitBasePriceNaira: pricing.unitBasePriceNaira,
    unitVeraFeeNaira: pricing.unitVeraFeeNaira,
    unitCheckoutPriceNaira,
    unitOrganizerNetNaira,
    totalBasePriceNaira: pricing.unitBasePriceNaira,
    totalVeraFeeNaira: pricing.unitVeraFeeNaira,
    totalCheckoutNaira: unitCheckoutPriceNaira,
    organizerNetNaira: unitOrganizerNetNaira,
    basePriceNaira: pricing.unitBasePriceNaira,
    veraFeeNaira: pricing.unitVeraFeeNaira,
    promoDiscountNaira: discount,
  };
};

/**
 * What the buyer is charged for a whole basket, and what the organizer keeps.
 * The ticket's own breakdown is passed through untouched so callers that only
 * care about tickets keep reading exactly what they read before.
 */
const computeCheckoutTotals = ({ ticketPricing, addOnPricings = [] }) => {
  const addOnTotals = addOnPricings.reduce(
    (sum, line) => ({
      basePriceNaira: sum.basePriceNaira + line.totalBasePriceNaira,
      veraFeeNaira: sum.veraFeeNaira + line.totalVeraFeeNaira,
      totalCheckoutNaira: sum.totalCheckoutNaira + line.totalCheckoutNaira,
      organizerNetNaira: sum.organizerNetNaira + line.organizerNetNaira,
      promoDiscountNaira:
        sum.promoDiscountNaira + Number(line.promoDiscountNaira || 0),
    }),
    {
      basePriceNaira: 0,
      veraFeeNaira: 0,
      totalCheckoutNaira: 0,
      organizerNetNaira: 0,
      promoDiscountNaira: 0,
    },
  );

  return {
    ticket: ticketPricing,
    addOns: addOnTotals,
    totalCheckoutNaira:
      ticketPricing.totalCheckoutNaira + addOnTotals.totalCheckoutNaira,
    organizerNetNaira:
      ticketPricing.organizerNetNaira + addOnTotals.organizerNetNaira,
    veraFeeNaira: ticketPricing.veraFeeNaira + addOnTotals.veraFeeNaira,
    promoDiscountNaira:
      Number(ticketPricing.promoDiscountNaira || 0) +
      Number(addOnTotals.promoDiscountNaira || 0),
  };
};

module.exports = {
  DEFAULT_PLATFORM_FEE_PERCENT,
  SUPPORTED_FEE_MODES,
  normalizeEventFeeConfig,
  computePrimaryTicketPricing,
  computeAddOnPricing,
  computeCheckoutTotals,
  computePromoDiscountNaira,
  withPromoDiscount,
  splitDiscountAcrossUnits,
  splitDiscountAcrossAmounts,
  buildSeatPricing,
};
