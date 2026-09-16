/**
 * OpenStreetMap's geocoder, proxied for the mobile app. Mirrors the web
 * dashboard's Route Handler (web/lib/api/nominatim.ts): the identifying
 * User-Agent their usage policy requires is actually sent, and a user's
 * typing reaches OSM from our server rather than from their device.
 */
const ApiError = require("../utils/api-error");

const NOMINATIM = "https://nominatim.openstreetmap.org";

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || "VeraEvents/1.0 (mobile app)";

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map();

const readCache = (key) => {
  const hit = cache.get(key);

  if (!hit) {
    return undefined;
  }

  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return hit.value;
};

const writeCache = (key, value) => {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

const toResult = (place) => {
  const latitude = Number(place?.lat);
  const longitude = Number(place?.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const address = place.address || {};

  return {
    label: place.display_name || "",
    name:
      place.name ||
      [address.road, address.suburb, address.city || address.town]
        .filter(Boolean)
        .join(", ") ||
      place.display_name ||
      "Dropped pin",
    latitude,
    longitude,
    state: String(address.state || address.region || "").replace(/\s+State$/i, ""),
    country: address.country || "",
  };
};

const call = async (path, params) => {
  const url = new URL(`${NOMINATIM}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");

  const cacheKey = url.toString();
  const cached = readCache(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  let body;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Nominatim responded ${response.status}`);
    }

    body = await response.json();
  } catch {
    throw new ApiError(502, "Address lookup is unavailable");
  }

  writeCache(cacheKey, body);
  return body;
};

const geocodeSearch = async ({ query, countryCodes }) => {
  const places = await call("/search", {
    q: query,
    limit: "6",
    ...(countryCodes ? { countrycodes: countryCodes } : {}),
  });

  return (Array.isArray(places) ? places : [])
    .map(toResult)
    .filter(Boolean);
};

const geocodeReverse = async ({ latitude, longitude }) => {
  const place = await call("/reverse", {
    lat: String(latitude),
    lon: String(longitude),
  });

  return toResult(place);
};

module.exports = {
  geocodeSearch,
  geocodeReverse,
};
