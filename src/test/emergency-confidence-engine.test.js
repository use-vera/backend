const { computeConfidence } = require("../services/emergency-confidence-engine.service");

const now = new Date("2026-07-15T12:00:00.000Z");

const baseReport = (overrides = {}) => ({
  category: "fire",
  latitude: 6.5244,
  longitude: 3.3792,
  attendeeUserId: `user_${Math.random()}`,
  createdAt: now,
  updatedAt: now,
  confidenceWeight: 1,
  ...overrides,
});

test("no reports yields zero confidence and low level", () => {
  const result = computeConfidence({ reports: [], now });

  expect(result.score).toBe(0);
  expect(result.level).toBe("low");
  expect(result.centroid).toBeNull();
});

test("a single report never reaches high confidence on its own", () => {
  const result = computeConfidence({ reports: [baseReport()], now });

  expect(result.score).toBeLessThan(70);
});

test("many unique, clustered, category-agreeing, recent reports reach high confidence", () => {
  const reports = Array.from({ length: 20 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      latitude: 6.5244 + index * 0.00001,
      longitude: 3.3792 + index * 0.00001,
      createdAt: new Date(now.getTime() - index * 1000),
      updatedAt: new Date(now.getTime() - index * 1000),
    }),
  );

  const result = computeConfidence({ reports, now });

  expect(result.level).toBe("high");
  expect(result.score).toBeGreaterThanOrEqual(70);
  expect(result.uniqueReporterCount).toBe(20);
  expect(result.modalCategory).toBe("fire");
});

test("tightly clustered reports score higher than widely scattered reports, all else equal", () => {
  const clustered = Array.from({ length: 10 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      latitude: 6.5244 + index * 0.00001,
      longitude: 3.3792 + index * 0.00001,
    }),
  );

  const scattered = Array.from({ length: 10 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      latitude: 6.5244 + index * 0.05,
      longitude: 3.3792 + index * 0.05,
    }),
  );

  const clusteredResult = computeConfidence({ reports: clustered, now });
  const scatteredResult = computeConfidence({ reports: scattered, now });

  expect(clusteredResult.breakdown.clusterScore).toBeGreaterThan(
    scatteredResult.breakdown.clusterScore,
  );
  expect(clusteredResult.score).toBeGreaterThan(scatteredResult.score);
});

test("agreeing categories score higher than wildly mixed categories, all else equal", () => {
  const categories = ["fire", "medical", "security_threat", "weather", "other", "violence", "crowd_crush", "structural_collapse", "other", "fire"];

  const agreeing = Array.from({ length: 10 }, (_, index) =>
    baseReport({ attendeeUserId: `user_${index}`, category: "fire" }),
  );

  const mixed = Array.from({ length: 10 }, (_, index) =>
    baseReport({ attendeeUserId: `user_${index}`, category: categories[index] }),
  );

  const agreeingResult = computeConfidence({ reports: agreeing, now });
  const mixedResult = computeConfidence({ reports: mixed, now });

  expect(agreeingResult.breakdown.categoryScore).toBeGreaterThan(
    mixedResult.breakdown.categoryScore,
  );
  expect(agreeingResult.score).toBeGreaterThan(mixedResult.score);
});

test("a rapid burst of reports scores higher on rate than the same count trickling in over hours", () => {
  const burst = Array.from({ length: 10 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      createdAt: new Date(now.getTime() - index * 1000),
      updatedAt: new Date(now.getTime() - index * 1000),
    }),
  );

  const trickle = Array.from({ length: 10 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      createdAt: new Date(now.getTime() - index * 30 * 60 * 1000),
      updatedAt: new Date(now.getTime() - index * 30 * 60 * 1000),
    }),
  );

  const burstResult = computeConfidence({ reports: burst, now });
  const trickleResult = computeConfidence({ reports: trickle, now });

  expect(burstResult.reportsPerMinute).toBeGreaterThan(trickleResult.reportsPerMinute);
  expect(burstResult.breakdown.rateScore).toBeGreaterThan(trickleResult.breakdown.rateScore);
});

test("old, un-renewed reports carry less weight than fresh ones (recency decay)", () => {
  const fresh = Array.from({ length: 10 }, (_, index) =>
    baseReport({ attendeeUserId: `user_${index}` }),
  );

  const stale = Array.from({ length: 10 }, (_, index) =>
    baseReport({
      attendeeUserId: `user_${index}`,
      createdAt: new Date(now.getTime() - 90 * 60 * 1000),
      updatedAt: new Date(now.getTime() - 90 * 60 * 1000),
    }),
  );

  const freshResult = computeConfidence({ reports: fresh, now });
  const staleResult = computeConfidence({ reports: stale, now });

  expect(freshResult.score).toBeGreaterThan(staleResult.score);
});

test("higher sensitivity scales the score up, lower sensitivity scales it down", () => {
  const reports = Array.from({ length: 8 }, (_, index) =>
    baseReport({ attendeeUserId: `user_${index}` }),
  );

  const neutral = computeConfidence({ reports, now, sensitivity: 1 });
  const boosted = computeConfidence({ reports, now, sensitivity: 2 });
  const dampened = computeConfidence({ reports, now, sensitivity: 0.5 });

  expect(boosted.score).toBeGreaterThanOrEqual(neutral.score);
  expect(dampened.score).toBeLessThanOrEqual(neutral.score);
});
