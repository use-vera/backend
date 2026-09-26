/**
 * What a vendor order costs, and who pays it.
 *
 * Vera's fee comes out of the vendor's side, the way an organizer's fee is
 * absorbed by default: the buyer pays the menu price and nothing else, so the
 * number on the item is the number they are charged.
 *
 * An organizer earns from vendors through the stall fee alone. Taking a cut
 * of every order on top of it was two charges for one thing, so orders now
 * split two ways rather than three.
 *
 * The buyer-facing service fee is deliberately 0 for now. It exists as a
 * constant so turning it on later is one line here rather than a hunt through
 * the order service, and so tests can pin the behaviour either way.
 */
const toNumber = (value, fallback) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const VENDOR_PLATFORM_FEE_PERCENT = toNumber(
  process.env.VENDOR_PLATFORM_FEE_PERCENT,
  5,
);

const VENDOR_ORDER_SERVICE_FEE_NAIRA = toNumber(
  process.env.VENDOR_ORDER_SERVICE_FEE_NAIRA,
  0,
);

/**
 * Splits one order between Vera and the vendor.
 *
 * The vendor takes the remainder rather than its own rounded share, so the
 * parts always add back up to the subtotal: no naira is invented or lost.
 */
const computeVendorOrderPricing = ({
  subtotalNaira,
  platformFeePercent = VENDOR_PLATFORM_FEE_PERCENT,
  serviceFeeNaira = VENDOR_ORDER_SERVICE_FEE_NAIRA,
}) => {
  const subtotal = Math.max(0, Math.round(Number(subtotalNaira || 0)));
  const safeFee = Math.min(Math.max(Number(platformFeePercent || 0), 0), 100);

  const veraFeeNaira = Math.round((subtotal * safeFee) / 100);
  const vendorNetNaira = Math.max(0, subtotal - veraFeeNaira);
  const serviceFee = Math.max(0, Math.round(Number(serviceFeeNaira || 0)));

  return {
    subtotalNaira: subtotal,
    serviceFeeNaira: serviceFee,
    /* What the buyer is charged, and the only number a payment is created
       for. */
    totalChargedNaira: subtotal + serviceFee,
    veraFeeNaira,
    vendorNetNaira,
    platformFeePercent: safeFee,
  };
};

module.exports = {
  VENDOR_ORDER_SERVICE_FEE_NAIRA,
  VENDOR_PLATFORM_FEE_PERCENT,
  computeVendorOrderPricing,
};
