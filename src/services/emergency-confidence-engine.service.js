/**
 * The Confidence Engine — deliberately isolated from persistence, auth, and
 * notifications. It takes plain report data in and returns plain numbers
 * out, which is what makes it swappable later (e.g. for an ML-based
 * scorer) without touching orchestration, lifecycle, or notification code.
 * This module is the single integration point for any future AI-driven
 * detection logic described in the product spec.
 *
 * Confidence is never a fixed report count. It blends five signals, each
 * computed over the reports currently linked to one emergency:
 *   - count: saturating function of weighted unique reporters
 *   - rate: reports/minute burst detection (spike = high confidence)
 *   - uniqueness: unique attendees / total reports
 *   - clustering: how tightly the report coordinates group together
 *   - category agreement: how dominant the most-reported category is
 *
 * Each report is recency-weighted using `updatedAt` (exponential decay,
 * half-life ~10 minutes) so older, un-renewed reports gradually lose
 * influence — a resubmission within the cooldown window refreshes a
 * report's `updatedAt` without changing its `createdAt`, which is what the
 * rate/spike signal uses instead (only genuinely new reports count as a
 * burst; renewals of an existing report aren't a second data point).
 */

const RECENCY_HALF_LIFE_MINUTES = 10;
const RATE_WINDOW_MINUTES = 5;
const CLUSTER_TIGHT_METERS = 30;
const CLUSTER_LOOSE_METERS = 300;

const EARTH_RADIUS_METERS = 6378100;

const toRadians = (value) => (value * Math.PI) / 180;

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Saturating curve: 0 at x=0, approaches 100 as x grows. `scale` controls
// how quickly it saturates (smaller scale = saturates with fewer reports).
const saturate = (x, scale) => 100 * (1 - Math.exp(-x / scale));

const recencyWeight = (report, now) => {
  const ageMinutes = Math.max(0, (now.getTime() - new Date(report.updatedAt).getTime()) / 60000);
  return Math.exp(-ageMinutes / RECENCY_HALF_LIFE_MINUTES);
};

const computeCentroid = (weightedPoints) => {
  const totalWeight = weightedPoints.reduce((sum, p) => sum + p.weight, 0);

  if (totalWeight <= 0) {
    return null;
  }

  const latitude =
    weightedPoints.reduce((sum, p) => sum + p.latitude * p.weight, 0) / totalWeight;
  const longitude =
    weightedPoints.reduce((sum, p) => sum + p.longitude * p.weight, 0) / totalWeight;

  return { latitude, longitude };
};

const computeCategoryWeights = (reports, weights) => {
  const totals = new Map();

  reports.forEach((report, index) => {
    const weight = weights[index];
    totals.set(report.category, (totals.get(report.category) || 0) + weight);
  });

  let modalCategory = null;
  let modalWeight = -Infinity;

  totals.forEach((weight, category) => {
    if (weight > modalWeight) {
      modalWeight = weight;
      modalCategory = category;
    }
  });

  return { totals, modalCategory, modalWeight };
};

/**
 * @param {object} params
 * @param {Array<{category:string, latitude:number, longitude:number, attendeeUserId:string, createdAt:Date|string, updatedAt:Date|string, confidenceWeight?:number}>} params.reports
 * @param {Date} params.now
 * @param {number} [params.sensitivity=1] - per-event tuning multiplier (0.5-2)
 */
const computeConfidence = ({ reports, now, sensitivity = 1 }) => {
  if (!Array.isArray(reports) || reports.length === 0) {
    return {
      score: 0,
      level: "low",
      breakdown: {
        countScore: 0,
        rateScore: 0,
        uniquenessScore: 0,
        clusterScore: 0,
        categoryScore: 0,
      },
      reportsPerMinute: 0,
      uniqueReporterCount: 0,
      centroid: null,
      modalCategory: null,
    };
  }

  const weights = reports.map((report) => {
    const severity = Number(report.confidenceWeight) || 1;
    return recencyWeight(report, now) * severity;
  });

  const uniqueReporterIds = new Set(reports.map((report) => String(report.attendeeUserId)));
  const uniqueReporterCount = uniqueReporterIds.size;

  const weightedUniqueCount = reports.reduce((sum, report, index) => {
    // Only count the first (most recent) report per attendee toward the
    // "how many distinct people are seeing this" signal.
    return sum + weights[index];
  }, 0) / Math.max(1, reports.length / Math.max(1, uniqueReporterCount));

  const countScore = saturate(weightedUniqueCount, 3);

  const rateWindowStart = new Date(now.getTime() - RATE_WINDOW_MINUTES * 60000);
  const recentNewReports = reports.filter(
    (report) => new Date(report.createdAt).getTime() >= rateWindowStart.getTime(),
  );
  const reportsPerMinute = recentNewReports.length / RATE_WINDOW_MINUTES;
  const rateScore = saturate(reportsPerMinute, 3);

  const uniquenessRatio = uniqueReporterCount / reports.length;
  const uniquenessScore = clamp(uniquenessRatio * 100, 0, 100);

  const weightedPoints = reports.map((report, index) => ({
    latitude: report.latitude,
    longitude: report.longitude,
    weight: weights[index],
  }));
  const centroid = computeCentroid(weightedPoints);

  let clusterScore = 50;
  if (centroid && reports.length > 1) {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
    const avgDistance =
      reports.reduce((sum, report, index) => {
        const distance = haversineMeters(
          report.latitude,
          report.longitude,
          centroid.latitude,
          centroid.longitude,
        );
        return sum + distance * weights[index];
      }, 0) / totalWeight;

    if (avgDistance <= CLUSTER_TIGHT_METERS) {
      clusterScore = 100;
    } else if (avgDistance >= CLUSTER_LOOSE_METERS) {
      clusterScore = 0;
    } else {
      clusterScore =
        100 *
        (1 -
          (avgDistance - CLUSTER_TIGHT_METERS) / (CLUSTER_LOOSE_METERS - CLUSTER_TIGHT_METERS));
    }
  } else if (reports.length === 1) {
    // A single report has no spread to measure — treat as neutral rather
    // than penalizing or rewarding clustering on a sample of one.
    clusterScore = 50;
  }

  const { totals, modalCategory, modalWeight } = computeCategoryWeights(reports, weights);
  const totalCategoryWeight = Array.from(totals.values()).reduce((sum, w) => sum + w, 0) || 1;
  const categoryScore = clamp((modalWeight / totalCategoryWeight) * 100, 0, 100);

  const breakdown = {
    countScore,
    rateScore,
    uniquenessScore,
    clusterScore,
    categoryScore,
  };

  const rawScore =
    countScore * 0.2 +
    rateScore * 0.25 +
    uniquenessScore * 0.15 +
    clusterScore * 0.2 +
    categoryScore * 0.2;

  const score = clamp(Math.round(rawScore * clamp(sensitivity, 0.5, 2)), 0, 100);

  const level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";

  return {
    score,
    level,
    breakdown,
    reportsPerMinute: Math.round(reportsPerMinute * 100) / 100,
    uniqueReporterCount,
    centroid,
    modalCategory,
  };
};

module.exports = {
  computeConfidence,
};
