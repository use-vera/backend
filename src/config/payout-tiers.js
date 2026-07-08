/**
 * Settlement delay per organizer trust tier. Changing a delay is a one-line
 * edit + redeploy here — the settlement job's logic never changes shape,
 * it just reads whatever this map says for the organizer's payoutTier.
 */
const SETTLEMENT_DELAY_HOURS_BY_TIER = {
  standard: 24,
  trusted: 2,
  enterprise: 0,
};

const DEFAULT_PAYOUT_TIER = "standard";

const getSettlementDelayHours = (payoutTier) =>
  SETTLEMENT_DELAY_HOURS_BY_TIER[payoutTier] ??
  SETTLEMENT_DELAY_HOURS_BY_TIER[DEFAULT_PAYOUT_TIER];

module.exports = {
  SETTLEMENT_DELAY_HOURS_BY_TIER,
  DEFAULT_PAYOUT_TIER,
  getSettlementDelayHours,
};
