/**
 * How much a vendor may sell before Vera asks for more about who they are.
 *
 * The ladder is the point: a bank account is enough to start, a BVN lifts the
 * ceiling, a CAC number removes it. Each step asks for one thing, and only
 * once the last one is actually in the way.
 *
 * Counted on lifetime sales, because "before we ask" is a one-off threshold
 * rather than a monthly allowance.
 */
const toNumber = (value, fallback) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const VENDOR_SALES_LIMIT_NAIRA = Object.freeze({
  starter: toNumber(process.env.VENDOR_STARTER_LIMIT_NAIRA, 500_000),
  verified: toNumber(process.env.VENDOR_VERIFIED_LIMIT_NAIRA, 5_000_000),
  /* No ceiling for a registered business. */
  registered: null,
});

const limitForLevel = (level) =>
  VENDOR_SALES_LIMIT_NAIRA[level] ?? VENDOR_SALES_LIMIT_NAIRA.starter;

/** What the next step asks for, in the words the vendor will see. */
const NEXT_LEVEL = Object.freeze({
  starter: { level: "verified", needs: "your BVN and date of birth" },
  verified: { level: "registered", needs: "your CAC registration number" },
  registered: null,
});

module.exports = { NEXT_LEVEL, VENDOR_SALES_LIMIT_NAIRA, limitForLevel };
