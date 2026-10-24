const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventRating = require("../models/event-rating.model");
const Follow = require("../models/follow.model");
const SavedEvent = require("../models/saved-event.model");
const Category = require("../models/category.model");

/* Lazy, because event.service is large and requires much of the app. */
const events = () => require("./event.service");

/**
 * Home, Discover and the map: which events to show someone, in what order,
 * and why. Everything here reads; nothing writes.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EARTH_RADIUS_KM = 6378.1;
/* Lagos has no daylight saving, so a fixed offset gives local hours and days. */
const LAGOS_OFFSET_MS = HOUR_MS;
const CANDIDATE_LIMIT = 500;

const toIdString = (value) => String(value?._id || value || "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const lagosHour = (date) => new Date(date.getTime() + LAGOS_OFFSET_MS).getUTCHours();
/** Midnight in Lagos on the day `date` falls on, as a real instant. */
const lagosDayStart = (date) => {
  const local = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET_MS);
};
const lagosWeekday = (date) => new Date(date.getTime() + LAGOS_OFFSET_MS).getUTCDay();
const lagosDateKey = (date) => new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

const distanceKm = (aLat, aLng, bLat, bLng) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/* The cheapest way in: the lowest tier on sale, else the event's own price. */
const priceFromNaira = (event) => {
  if (!event.isPaid) return 0;
  const tiers = (event.ticketCategories || []).map((tier) => Number(tier.priceNaira)).filter((price) => price > 0);
  return tiers.length ? Math.min(...tiers) : Number(event.ticketPriceNaira || 0);
};

/* ---------- Candidates ---------- */

/**
 * Published events still to come (or happening now), each with the
 * occurrence that matters right now. Optionally narrowed to a state or a
 * circle on the map.
 */
const loadCandidates = async ({ now, horizonDays = 30, state, near }) => {
  const horizon = new Date(now.getTime() + horizonDays * DAY_MS);
  const query = {
    status: "published",
    $or: [
      { endsAt: { $gte: now }, startsAt: { $lte: horizon } },
      {
        "recurrence.type": { $nin: ["none", null] },
        $or: [{ "recurrence.endsOn": null }, { "recurrence.endsOn": { $gte: now } }],
      },
    ],
  };

  /* Your city, plus events that never said which state they're in: plenty
     of hosts leave it blank, and hiding those would empty the app. Events
     clearly elsewhere are left out. */
  const trimmedState = String(state || "").trim();
  if (trimmedState) {
    query.$and = [
      {
        $or: [
          { state: new RegExp(`^${escapeRegex(trimmedState)}$`, "i") },
          { state: "" },
          { state: null },
          { state: { $exists: false } },
        ],
      },
    ];
  }

  if (near) {
    query.location = {
      $geoWithin: { $centerSphere: [[near.lng, near.lat], near.radiusKm / EARTH_RADIUS_KM] },
    };
  }

  const docs = await Event.find(query)
    .populate(events().EVENT_CARD_POPULATE)
    .sort({ startsAt: 1 })
    .limit(CANDIDATE_LIMIT);

  return docs
    .map((event) => ({ event, occurrence: events().resolveOccurrenceWindow(event, now) }))
    .filter(({ occurrence }) => occurrence && occurrence.endsAt >= now && occurrence.startsAt <= horizon);
};

/* ---------- What we know about the viewer ---------- */

/**
 * The signals a match score is built from. Each one is something the
 * person did or chose, so every point of the score can be explained.
 */
const loadViewerSignals = async (userId) => {
  if (!userId) {
    return { preferred: new Set(), state: "", following: new Set(), sharingFollowing: [], typicalPriceNaira: null, lovedCategories: new Set() };
  }

  const [user, followingIds, pastTickets, goodRatings] = await Promise.all([
    User.findById(userId).select("state preferences.preferredCategoryIds").lean(),
    Follow.find({ followerUserId: userId }).distinct("followingUserId"),
    EventTicket.find({ buyerUserId: userId, status: { $in: ["paid", "used"] }, unitPriceNaira: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(40)
      .select("unitPriceNaira")
      .lean(),
    EventRating.find({ userId, rating: { $gte: 4 } }).select("eventId").limit(50).lean(),
  ]);

  /* Only friends who share their activity can be counted as "going". */
  const sharingFollowing = followingIds.length
    ? await User.find({ _id: { $in: followingIds }, "preferences.shareActivityWithFollowers": { $ne: false }, deletedAt: null })
        .distinct("_id")
    : [];

  const prices = pastTickets.map((ticket) => ticket.unitPriceNaira).sort((a, b) => a - b);
  const typicalPriceNaira = prices.length ? prices[Math.floor(prices.length / 2)] : null;

  const lovedEvents = goodRatings.length
    ? await Event.find({ _id: { $in: goodRatings.map((rating) => rating.eventId) } }).select("categoryIds").lean()
    : [];

  return {
    preferred: new Set((user?.preferences?.preferredCategoryIds || []).map(String)),
    state: String(user?.state || "").trim().toLowerCase(),
    following: new Set(followingIds.map(String)),
    sharingFollowing,
    typicalPriceNaira,
    lovedCategories: new Set(lovedEvents.flatMap((event) => (event.categoryIds || []).map(toIdString))),
  };
};

/* Friends (people you follow who share activity) holding tickets, per event. */
const loadFriendsGoing = async (eventIds, sharingFollowing) => {
  const map = new Map();
  if (!eventIds.length || !sharingFollowing.length) return map;

  const tickets = await EventTicket.find({
    eventId: { $in: eventIds },
    buyerUserId: { $in: sharingFollowing },
    status: { $in: ["paid", "used"] },
  })
    .select("eventId buyerUserId")
    .populate("buyerUserId", "fullName avatarUrl handle")
    .lean();

  for (const ticket of tickets) {
    if (!ticket.buyerUserId) continue;
    const key = toIdString(ticket.eventId);
    const people = map.get(key) || new Map();
    people.set(toIdString(ticket.buyerUserId), {
      _id: toIdString(ticket.buyerUserId),
      fullName: ticket.buyerUserId.fullName,
      handle: ticket.buyerUserId.handle || "",
      avatarUrl: ticket.buyerUserId.avatarUrl || "",
    });
    map.set(key, people);
  }

  return new Map([...map.entries()].map(([key, people]) => [key, [...people.values()]]));
};

/* Tickets sold per event since `since`. */
const loadSalesSince = async (eventIds, since) => {
  if (!eventIds.length) return new Map();
  const rows = await EventTicket.aggregate([
    { $match: { eventId: { $in: eventIds }, status: { $in: ["paid", "used"] }, paidAt: { $gte: since } } },
    { $group: { _id: "$eventId", quantity: { $sum: "$quantity" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), Number(row.quantity || 0)]));
};

/* ---------- Match score ---------- */

/**
 * 0–99, with the reasons it's made of. Only things the person chose or did
 * count, so "see why" is always true. Without any signals there is no
 * score: a number made of nothing would be a guess dressed up as a fact.
 */
const scoreMatch = ({ event, signals, friends = [] }) => {
  const reasons = [];
  let score = 0;

  const categories = (event.categoryIds || []).map(toIdString);
  const sceneHits = categories.filter((id) => signals.preferred.has(id)).length;
  if (sceneHits > 0) {
    score += sceneHits > 1 ? 40 : 32;
    reasons.push("One of your scenes");
  }

  if (categories.some((id) => signals.lovedCategories.has(id))) {
    score += 12;
    reasons.push("Like nights you rated 4★ or more");
  }

  if (signals.following.has(toIdString(event.organizerUserId))) {
    score += 15;
    reasons.push("A host you follow");
  }

  if (friends.length > 0) {
    score += Math.min(15, friends.length * 6);
    reasons.push(friends.length === 1 ? "A friend is going" : `${friends.length} friends are going`);
  }

  if (signals.state && String(event.state || "").trim().toLowerCase() === signals.state) {
    score += 8;
    reasons.push("In your city");
  }

  const price = priceFromNaira(event);
  if (signals.typicalPriceNaira !== null && price <= signals.typicalPriceNaira * 1.25) {
    score += 10;
    reasons.push(price === 0 ? "Free" : "Around what you usually pay");
  }

  /* Being in your city alone isn't a match: Home only shows your city anyway. */
  const meaningful = reasons.filter((reason) => reason !== "In your city");
  return { score: meaningful.length ? Math.min(99, score) : null, reasons };
};

/* ---------- Shaping ---------- */

/* Cards for the app, each with its match and the friends going. */
const presentWithMatch = async ({ entries, actorUserId, signals, friendsMap }) => {
  const cards = await events().presentEventCards({ events: entries.map((entry) => entry.event), actorUserId });
  return cards.map((card, index) => {
    const event = entries[index].event;
    const friends = friendsMap.get(toIdString(event._id)) || [];
    return {
      ...card,
      priceFromNaira: priceFromNaira(event),
      match: scoreMatch({ event, signals, friends }),
      friendsGoing: friends.slice(0, 3),
      friendsGoingCount: friends.length,
    };
  });
};

const rankByMatch = (entries, signals, friendsMap) =>
  entries
    .map((entry) => ({
      entry,
      match: scoreMatch({ event: entry.event, signals, friends: friendsMap.get(toIdString(entry.event._id)) || [] }),
    }))
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || a.entry.occurrence.startsAt - b.entry.occurrence.startsAt)
    .map(({ entry }) => entry);

/* The coming Friday to Sunday in Lagos; this one if it's not over yet. */
const weekendDays = (now) => {
  const today = lagosDayStart(now);
  const weekday = lagosWeekday(now);
  const toFriday = weekday === 0 ? -2 : weekday === 6 ? -1 : 5 - weekday;
  const friday = new Date(today.getTime() + toFriday * DAY_MS);
  return [0, 1, 2].map((offset) => new Date(friday.getTime() + offset * DAY_MS)).filter((day) => day.getTime() + DAY_MS > now.getTime());
};

const overlaps = (occurrence, start, end) => occurrence.startsAt < end && occurrence.endsAt > start;

/* ---------- Home ---------- */

/**
 * Everything Home shows in one call: your next night, picks for you,
 * friends going, this weekend by day, and, for someone with no signals
 * yet, the most-saved nights this week.
 */
const getHome = async ({ userId }) => {
  const now = new Date();
  const signals = await loadViewerSignals(userId);
  const user = await User.findById(userId).select("state").lean();
  const candidates = await loadCandidates({ now, horizonDays: 21, state: user?.state });
  const ids = candidates.map((entry) => entry.event._id);
  const friendsMap = await loadFriendsGoing(ids, signals.sharingFollowing);

  const ranked = rankByMatch(candidates, signals, friendsMap);
  const forYouEntries = ranked.filter((entry) => scoreMatch({ event: entry.event, signals, friends: friendsMap.get(toIdString(entry.event._id)) || [] }).score !== null).slice(0, 10);

  const friendEntries = candidates
    .filter((entry) => (friendsMap.get(toIdString(entry.event._id)) || []).length > 0)
    .sort((a, b) => (friendsMap.get(toIdString(b.event._id)).length - friendsMap.get(toIdString(a.event._id)).length) || a.occurrence.startsAt - b.occurrence.startsAt)
    .slice(0, 8);

  const days = weekendDays(now);
  const weekendEntries = days.map((day) => ({
    day,
    entries: rankByMatch(candidates.filter((entry) => overlaps(entry.occurrence, day, new Date(day.getTime() + DAY_MS))), signals, friendsMap).slice(0, 8),
  }));

  /* Most saved in the last week, for anyone who hasn't given us much to go on. */
  let startHere = [];
  if (forYouEntries.length === 0 && ids.length) {
    const rows = await SavedEvent.aggregate([
      { $match: { eventId: { $in: ids }, createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } } },
      { $group: { _id: "$eventId", saves: { $sum: 1 } } },
      { $sort: { saves: -1 } },
      { $limit: 5 },
    ]);
    const savesById = new Map(rows.map((row) => [String(row._id), row.saves]));
    const popular = candidates.filter((entry) => savesById.has(toIdString(entry.event._id)));
    const fallback = popular.length ? popular : candidates.slice(0, 5);
    const cards = await presentWithMatch({ entries: fallback.slice(0, 5), actorUserId: userId, signals, friendsMap });
    startHere = cards
      .map((card) => ({ ...card, savesThisWeek: savesById.get(toIdString(card._id)) || 0 }))
      .sort((a, b) => b.savesThisWeek - a.savesThisWeek);
  }

  const nextTicket = await EventTicket.find({ buyerUserId: userId, status: "paid" })
    .select("eventId")
    .lean()
    .then(async (tickets) => {
      const upcoming = candidates
        .filter((entry) => tickets.some((ticket) => toIdString(ticket.eventId) === toIdString(entry.event._id)))
        .sort((a, b) => a.occurrence.startsAt - b.occurrence.startsAt)[0];
      if (!upcoming) return null;
      const ticket = tickets.find((item) => toIdString(item.eventId) === toIdString(upcoming.event._id));
      const [card] = await events().presentEventCards({ events: [upcoming.event], actorUserId: userId });
      return { ticketId: toIdString(ticket._id), event: card };
    });

  const [forYou, friendsGoing, weekend] = await Promise.all([
    presentWithMatch({ entries: forYouEntries, actorUserId: userId, signals, friendsMap }),
    presentWithMatch({ entries: friendEntries, actorUserId: userId, signals, friendsMap }),
    Promise.all(
      weekendEntries.map(async ({ day, entries }) => ({
        date: lagosDateKey(day),
        items: await presentWithMatch({ entries, actorUserId: userId, signals, friendsMap }),
      })),
    ),
  ]);

  const preferred = [...signals.preferred];
  const scenes = await Category.find(preferred.length ? { _id: { $in: preferred }, isActive: true } : { isActive: true })
    .sort({ sortOrder: 1 })
    .limit(6)
    .select("name slug")
    .lean();

  return {
    city: user?.state || "",
    nextNight: nextTicket,
    forYou,
    friendsGoing,
    weekend,
    startHere,
    scenes: scenes.map((scene) => ({ _id: toIdString(scene._id), name: scene.name, slug: scene.slug })),
  };
};

/* ---------- Discover ---------- */

/** "trending now": most tickets sold in the last 24 hours. */
const getTrending = async ({ userId, limit = 10, state }) => {
  const now = new Date();
  const [signals, candidates] = await Promise.all([loadViewerSignals(userId), loadCandidates({ now, state })]);
  const ids = candidates.map((entry) => entry.event._id);
  const [sales, friendsMap] = await Promise.all([
    loadSalesSince(ids, new Date(now.getTime() - DAY_MS)),
    loadFriendsGoing(ids, signals.sharingFollowing),
  ]);

  const top = candidates
    .filter((entry) => (sales.get(toIdString(entry.event._id)) || 0) > 0)
    .sort((a, b) => sales.get(toIdString(b.event._id)) - sales.get(toIdString(a.event._id)))
    .slice(0, Math.min(20, Number(limit) || 10));

  const cards = await presentWithMatch({ entries: top, actorUserId: userId, signals, friendsMap });

  return {
    items: cards.map((card, index) => ({
      ...card,
      rank: index + 1,
      soldLast24h: sales.get(toIdString(card._id)) || 0,
      /* Under a sixth of the tickets left. */
      sellingFast: card.expectedTickets > 0 && card.remainingTickets > 0 && card.remainingTickets / card.expectedTickets < 0.15,
    })),
  };
};

const WHEN_WINDOWS = {
  tonight: (now) => {
    /* "Tonight" runs until 6AM, so a 1AM party still counts. */
    const start = now;
    const dayStart = lagosDayStart(new Date(now.getTime() - 6 * HOUR_MS));
    return [start, new Date(dayStart.getTime() + DAY_MS + 6 * HOUR_MS)];
  },
  now: (now) => [now, new Date(now.getTime() + 1)],
  weekend: (now) => {
    const days = weekendDays(now);
    if (!days.length) return [now, now];
    return [days[0] < now ? now : days[0], new Date(days[days.length - 1].getTime() + DAY_MS)];
  },
  week: (now) => [now, new Date(lagosDayStart(now).getTime() + 7 * DAY_MS)],
  all: (now) => [now, new Date(now.getTime() + 30 * DAY_MS)],
  /* The windows below are for Vera, who gets asked about other days than Discover's chips. */
  tomorrow: (now) => {
    const start = new Date(lagosDayStart(now).getTime() + DAY_MS);
    return [start, new Date(start.getTime() + DAY_MS + 6 * HOUR_MS)];
  },
  next_week: (now) => {
    const monday = new Date(lagosDayStart(now).getTime() + ((8 - lagosWeekday(now)) % 7 || 7) * DAY_MS);
    return [monday, new Date(monday.getTime() + 7 * DAY_MS)];
  },
  month: (now) => [now, new Date(now.getTime() + 30 * DAY_MS)],
  next_month: (now) => {
    const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - LAGOS_OFFSET_MS);
    const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 2, 1) - LAGOS_OFFSET_MS);
    return [start, end];
  },
};

/* How far ahead to load candidates so a window is fully covered. */
const horizonFor = (when) => (when === "next_month" ? 62 : 30);

/**
 * The filtered list behind Discover's chips and "all →": a time window,
 * a price ceiling, free only, friends going, a scene, or what's running at
 * a given moment. Best match first unless asked for soonest or cheapest.
 */
const filterEntries = ({ entries, now, when = "all", priceMax, free, friendsOnly, category, runningAt, friendsMap }) => {
  const [start, end] = (WHEN_WINDOWS[when] || WHEN_WINDOWS.all)(now);
  const moment = runningAt ? new Date(runningAt) : null;

  return entries.filter(({ event, occurrence }) => {
    if (moment ? !overlaps(occurrence, moment, new Date(moment.getTime() + 1)) : !overlaps(occurrence, start, end)) return false;
    const price = priceFromNaira(event);
    if (free && price > 0) return false;
    if (priceMax !== undefined && price > priceMax) return false;
    if (friendsOnly && !(friendsMap.get(toIdString(event._id)) || []).length) return false;
    if (category && !(event.categoryIds || []).map(toIdString).includes(String(category))) return false;
    return true;
  });
};

const sortEntries = (entries, sort, signals, friendsMap) => {
  if (sort === "soonest") return [...entries].sort((a, b) => a.occurrence.startsAt - b.occurrence.startsAt);
  if (sort === "cheapest") return [...entries].sort((a, b) => priceFromNaira(a.event) - priceFromNaira(b.event));
  return rankByMatch(entries, signals, friendsMap);
};

const listDiscover = async ({ userId, page = 1, limit = 20, sort = "match", state, ...filters }) => {
  const now = new Date();
  const [signals, candidates] = await Promise.all([loadViewerSignals(userId), loadCandidates({ now, state })]);
  const friendsMap = await loadFriendsGoing(candidates.map((entry) => entry.event._id), signals.sharingFollowing);
  const filtered = sortEntries(filterEntries({ entries: candidates, now, friendsMap, ...filters }), sort, signals, friendsMap);

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const pageEntries = filtered.slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber);
  const totalPages = Math.ceil(filtered.length / limitNumber);

  return {
    items: await presentWithMatch({ entries: pageEntries, actorUserId: userId, signals, friendsMap }),
    page: pageNumber,
    limit: limitNumber,
    totalItems: filtered.length,
    totalPages,
    hasNextPage: pageNumber < totalPages,
    hasPrevPage: pageNumber > 1,
  };
};

/* ---------- Vera ---------- */

/* Signals Vera may use, with the ones switched off on "what vera can see" taken out. */
const maskSignals = (signals, sees = {}) => ({
  ...signals,
  lovedCategories: sees.ratings === false ? new Set() : signals.lovedCategories,
  following: sees.following === false ? new Set() : signals.following,
  sharingFollowing: sees.following === false ? [] : signals.sharingFollowing,
  typicalPriceNaira: sees.usualSpend === false ? null : signals.typicalPriceNaira,
});

const textOf = (value) => String(value || "").toLowerCase();

/**
 * Events for Vera to choose from: the same candidates, filters and match
 * score as Discover, plus a free-text query ("jazz", "rooftop") matched on
 * names, descriptions and scene names. A query that matches nothing is
 * dropped rather than returning an empty list, and the result says so.
 */
const searchForVera = async ({ userId, when = "all", priceMax, free, friendsOnly, query, near, sees, includeLive = false, limit = 8 }) => {
  const now = new Date();
  const rawSignals = await loadViewerSignals(userId);
  const signals = maskSignals(rawSignals, sees);
  const [nearby, categories] = await Promise.all([
    loadCandidates({ now, horizonDays: horizonFor(when), state: near ? undefined : rawSignals.state, near: near ? { ...near, radiusKm: 30 } : undefined }),
    query ? Category.find({ isActive: true }).select("name").lean() : [],
  ]);
  /* Nothing close by (travelling, or a phone reporting somewhere odd): fall back to their city. */
  const nearbyEmpty = Boolean(near) && nearby.length === 0;
  const candidates = nearbyEmpty ? await loadCandidates({ now, horizonDays: horizonFor(when), state: rawSignals.state }) : nearby;
  const friendsMap = await loadFriendsGoing(candidates.map((entry) => entry.event._id), signals.sharingFollowing);
  /* Events already under way are left out unless asked for: "what's next" never means something that started an hour ago. */
  const showLive = includeLive || when === "now";
  const filtered = filterEntries({ entries: candidates, now, when, priceMax, free, friendsOnly, friendsMap }).filter(
    ({ occurrence }) => showLive || occurrence.startsAt > now,
  );

  let matched = filtered;
  let queryMatched = true;
  const terms = textOf(query).split(/\s+/).filter((term) => term.length > 2);
  if (terms.length) {
    const sceneIds = new Set(
      categories.filter((category) => terms.some((term) => textOf(category.name).includes(term))).map((category) => toIdString(category._id)),
    );
    matched = filtered.filter(({ event }) => {
      const text = `${textOf(event.name)} ${textOf(event.description)}`;
      return terms.some((term) => text.includes(term)) || (event.categoryIds || []).some((id) => sceneIds.has(toIdString(id)));
    });
    if (!matched.length) {
      matched = filtered;
      queryMatched = false;
    }
  }

  const ranked = rankByMatch(matched, signals, friendsMap).slice(0, Math.min(10, Math.max(1, limit)));
  const cards = await presentWithMatch({ entries: ranked, actorUserId: userId, signals, friendsMap });
  return {
    queryMatched,
    nearbyEmpty,
    items: cards.map((card, index) => {
      const event = ranked[index].event;
      const distance =
        near && !nearbyEmpty && Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
          ? distanceKm(near.lat, near.lng, event.latitude, event.longitude)
          : null;
      const { occurrence } = ranked[index];
      const access = events().resolveTicketSalesAccess(event, now);
      return {
        ...card,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        isLive: occurrence.startsAt <= now && occurrence.endsAt > now,
        ticketsOnSale: access.canPurchase,
        saleNote: access.canPurchase ? "" : access.reason,
        distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
      };
    }),
  };
};

/* ---------- Map ---------- */

/* The look of a pin: the best matches stand out, then what's live, then friends. */
const pinKind = ({ soldOut, isLive, friendsCount, isTop }) => {
  if (soldOut) return "soldout";
  if (isTop) return "top";
  if (isLive) return "live";
  if (friendsCount > 0) return "friends";
  return "price";
};

/**
 * Light pins for the map: just enough to draw and rank them. Only the
 * best `limit` are pinned; `total` says how many matched, so the screen
 * can say "38 tonight · best 12 pinned". For "tonight", `timeline` counts
 * what's running each hour, for the scrubber.
 */
const getMapPins = async ({ userId, lat, lng, radiusKm = 15, limit = 40, ...filters }) => {
  const now = new Date();
  const near = lat !== undefined && lng !== undefined ? { lat: Number(lat), lng: Number(lng), radiusKm: Number(radiusKm) } : null;
  const [signals, candidates] = await Promise.all([loadViewerSignals(userId), loadCandidates({ now, near })]);
  const withCoords = candidates.filter(({ event }) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude) && (event.latitude || event.longitude));
  const ids = withCoords.map((entry) => entry.event._id);
  const friendsMap = await loadFriendsGoing(ids, signals.sharingFollowing);

  const matched = sortEntries(filterEntries({ entries: withCoords, now, friendsMap, ...filters }), "match", signals, friendsMap);
  const pinnedEntries = matched.slice(0, Math.min(80, Number(limit) || 40));
  const cards = await events().presentEventCards({ events: pinnedEntries.map((entry) => entry.event), actorUserId: userId });

  /* "Top" is the best few with a real score, so green pins mean something:
     at least a scene of yours, or a host you follow and more. */
  const topIds = new Set(
    pinnedEntries
      .map((entry) => ({ id: toIdString(entry.event._id), match: scoreMatch({ event: entry.event, signals, friends: friendsMap.get(toIdString(entry.event._id)) || [] }) }))
      .filter((row) => (row.match.score ?? 0) >= 40)
      .slice(0, 3)
      .map((row) => row.id),
  );

  const pins = pinnedEntries.map((entry, index) => {
    const card = cards[index];
    const id = toIdString(entry.event._id);
    const friends = friendsMap.get(id) || [];
    const soldOut = card.expectedTickets > 0 && card.remainingTickets <= 0;
    const isLive = entry.occurrence.startsAt <= now && entry.occurrence.endsAt > now;
    const match = scoreMatch({ event: entry.event, signals, friends });

    return {
      _id: id,
      name: card.name,
      imageUrl: card.imageUrl || "",
      latitude: entry.event.latitude,
      longitude: entry.event.longitude,
      address: card.address,
      startsAt: card.nextOccurrenceAt,
      endsAt: card.nextOccurrenceEndsAt,
      priceFromNaira: priceFromNaira(entry.event),
      isLive,
      soldOut,
      matchScore: match.score,
      matchReasons: match.reasons,
      friendsGoing: friends.slice(0, 2),
      friendsGoingCount: friends.length,
      kind: pinKind({ soldOut, isLive, friendsCount: friends.length, isTop: topIds.has(id) }),
      distanceKm: near ? Math.round(distanceKm(near.lat, near.lng, entry.event.latitude, entry.event.longitude) * 10) / 10 : null,
    };
  });

  /* Hour by hour from 6PM to 4AM, Lagos time: what's on, and how much with friends. */
  let timeline = null;
  if (filters.when === "tonight" || filters.runningAt) {
    const base = lagosDayStart(new Date(now.getTime() - 6 * HOUR_MS));
    const night = filterEntries({ entries: withCoords, now, friendsMap, ...filters, runningAt: undefined, when: "tonight" });
    timeline = Array.from({ length: 11 }, (_, index) => {
      const at = new Date(base.getTime() + (18 + index) * HOUR_MS);
      const running = night.filter(({ occurrence }) => overlaps(occurrence, at, new Date(at.getTime() + HOUR_MS)));
      return {
        at: at.toISOString(),
        hour: lagosHour(at),
        running: running.length,
        withFriends: running.filter(({ event }) => (friendsMap.get(toIdString(event._id)) || []).length > 0).length,
      };
    });
  }

  return { pins, total: matched.length, pinned: pins.length, timeline };
};

/* ---------- Busiest hours ---------- */

/**
 * When it's busiest, from real check-in times: this event's own if it has
 * enough, else past events at the same venue, else past events by the same
 * host. Hours are Lagos time. Null when there isn't enough to say.
 */
const MIN_CHECK_INS = 10;

const getBusiestHours = async ({ eventId }) => {
  const event = await Event.findOne({ _id: eventId, status: { $in: ["published", "cancelled"] } })
    .select("organizerUserId eventCenterId")
    .lean();

  if (!event) {
    throw new ApiError(404, "Event not found", null, "EVENT_NOT_FOUND");
  }

  const histogramFor = async (eventIds) => {
    const rows = await EventTicket.aggregate([
      { $match: { eventId: { $in: eventIds }, status: "used", usedAt: { $ne: null } } },
      { $project: { hour: { $hour: { date: "$usedAt", timezone: "Africa/Lagos" } }, quantity: 1 } },
      { $group: { _id: "$hour", count: { $sum: { $ifNull: ["$quantity", 1] } } } },
    ]);
    const histogram = Array.from({ length: 24 }, () => 0);
    for (const row of rows) histogram[row._id] = row.count;
    return histogram;
  };

  const attempts = [
    { basis: "this_event", ids: async () => [event._id] },
    event.eventCenterId
      ? { basis: "venue", ids: () => Event.find({ eventCenterId: event.eventCenterId, _id: { $ne: event._id } }).distinct("_id") }
      : null,
    { basis: "host", ids: () => Event.find({ organizerUserId: event.organizerUserId, _id: { $ne: event._id } }).distinct("_id") },
  ].filter(Boolean);

  for (const attempt of attempts) {
    const ids = await attempt.ids();
    if (!ids.length) continue;
    const histogram = await histogramFor(ids);
    const sample = histogram.reduce((sum, count) => sum + count, 0);
    if (sample < MIN_CHECK_INS) continue;

    const peak = histogram.indexOf(Math.max(...histogram));
    return { basis: attempt.basis, histogram, sampleSize: sample, peakStartHour: peak, peakEndHour: (peak + 1) % 24 };
  }

  return { basis: null, histogram: null, sampleSize: 0, peakStartHour: null, peakEndHour: null };
};

module.exports = {
  scoreMatch,
  priceFromNaira,
  weekendDays,
  getHome,
  getTrending,
  listDiscover,
  getMapPins,
  getBusiestHours,
  searchForVera,
};
