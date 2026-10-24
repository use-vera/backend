/**
 * Tonight's rain outlook for a spot, in a few words ("Dry till 11PM").
 * Uses Open-Meteo, which is free and needs no key. Weather is a nicety:
 * any failure returns null and Vera carries on without it.
 */

const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 3000;
const RAIN_LIKELY = 50;
const HOURS_AHEAD = 12;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

const cache = new Map();

/* "21:00" → "9PM" */
const hourLabel = (localIso) => {
  const hour = Number(localIso.slice(11, 13));
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return `${hour % 12}${hour < 12 ? "AM" : "PM"}`;
};

const summarise = ({ times, chances, nowKey }) => {
  const upcoming = times
    .map((time, index) => ({ time, chance: Number(chances[index]) }))
    .filter((hour) => hour.time >= nowKey && Number.isFinite(hour.chance))
    .slice(0, HOURS_AHEAD);
  if (!upcoming.length) return null;

  const wet = upcoming.find((hour) => hour.chance >= RAIN_LIKELY);
  if (!wet) return `Dry till ${hourLabel(upcoming[upcoming.length - 1].time)}`;
  if (wet === upcoming[0]) return "Raining or about to";
  return `Rain likely from ${hourLabel(wet.time)}`;
};

const getRainOutlook = async ({ lat, lng, now = new Date() }) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  /* About 11 km squares: close enough for rain, and kinder to the free API. */
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const cached = cache.get(key);
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}` +
    "&hourly=precipitation_probability&forecast_days=2&timezone=Africa%2FLagos";

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json();
    const nowKey = new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 13);
    const value = summarise({
      times: body?.hourly?.time || [],
      chances: body?.hourly?.precipitation_probability || [],
      nowKey,
    });
    cache.set(key, { at: now.getTime(), value });
    return value;
  } catch {
    return null;
  }
};

module.exports = { getRainOutlook, summarise };
