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
    }),
    {
      basePriceNaira: 0,
      veraFeeNaira: 0,
      totalCheckoutNaira: 0,
      organizerNetNaira: 0,
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
  };
};

module.exports = {
  DEFAULT_PLATFORM_FEE_PERCENT,
  SUPPORTED_FEE_MODES,
  normalizeEventFeeConfig,
  computePrimaryTicketPricing,
  computeAddOnPricing,
  computeCheckoutTotals,
};
