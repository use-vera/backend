const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const User = require("../models/user.model");
const env = require("../config/env");

const roleWeight = {
  member: 1,
  admin: 2,
  owner: 3,
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeWorkspaceRef = (workspaceRef) =>
  String(workspaceRef || "").trim().toLowerCase();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const toMonthIndex = (value) => {
  const date = new Date(value);
  return date.getFullYear() * 12 + date.getMonth();
};

const addDays = (value, days) => new Date(value.getTime() + days * DAY_MS);

const addMonths = (value, months) => {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
};

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

const withBaseTime = (targetDate, baseTimeDate) => {
  const result = new Date(targetDate);
  result.setHours(
    baseTimeDate.getHours(),
    baseTimeDate.getMinutes(),
    baseTimeDate.getSeconds(),
    baseTimeDate.getMilliseconds(),
  );
  return result;
};

const getNthWeekdayOfMonth = (year, month, weekday, weekOfMonth) => {
  if (weekOfMonth === -1) {
    const lastDay = getDaysInMonth(year, month);
    const lastDate = new Date(year, month, lastDay);
    const offset = (lastDate.getDay() - weekday + 7) % 7;
    return new Date(year, month, lastDay - offset);
  }

  const firstDate = new Date(year, month, 1);
  const firstOffset = (weekday - firstDate.getDay() + 7) % 7;
  const targetDay = 1 + firstOffset + (weekOfMonth - 1) * 7;

  if (targetDay > getDaysInMonth(year, month)) {
    return null;
  }

  return new Date(year, month, targetDay);
};

const resolveWorkspaceByRef = async (workspaceRef) => {
  const normalized = normalizeWorkspaceRef(workspaceRef);

  if (!normalized) {
    throw new ApiError(400, "Workspace reference is required");
  }

  if (objectIdRegex.test(normalized)) {
    const byId = await Workspace.findById(normalized);

    if (byId) {
      return byId;
    }
  }

  const bySlug = await Workspace.findOne({ slug: normalized });

  if (!bySlug) {
    throw new ApiError(404, "Workspace not found");
  }

  return bySlug;
};

const requireWorkspaceAdmin = async (workspaceRef, userId) => {
  const workspace = await resolveWorkspaceByRef(workspaceRef);

  const membership = await Membership.findOne({
    workspaceId: workspace._id,
    userId,
    status: "active",
  });

  if (!membership || roleWeight[membership.role] < roleWeight.admin) {
    throw new ApiError(403, "Admin access is required for this workspace event");
  }

  return workspace;
};

const normalizeRecurrence = (recurrence, startsAt) => {
  const base = recurrence || { type: "none", interval: 1, daysOfWeek: [] };

  const normalized = {
    type: base.type || "none",
    interval: Number(base.interval || 1),
    daysOfWeek: Array.isArray(base.daysOfWeek)
      ? [...new Set(base.daysOfWeek.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))].sort((a, b) => a - b)
      : [],
    dayOfMonth:
      base.dayOfMonth !== undefined && base.dayOfMonth !== null
        ? Number(base.dayOfMonth)
        : null,
    weekOfMonth:
      base.weekOfMonth !== undefined && base.weekOfMonth !== null
        ? Number(base.weekOfMonth)
        : null,
    weekday:
      base.weekday !== undefined && base.weekday !== null
        ? Number(base.weekday)
        : null,
    endsOn: base.endsOn ? new Date(base.endsOn) : null,
  };

  if (normalized.type === "weekly" && normalized.daysOfWeek.length === 0) {
    normalized.daysOfWeek = [new Date(startsAt).getDay()];
  }

  if (normalized.type === "monthly-day" && !normalized.dayOfMonth) {
    normalized.dayOfMonth = new Date(startsAt).getDate();
  }

  if (normalized.type === "monthly-weekday") {
    if (normalized.weekday === null || normalized.weekday === undefined) {
      normalized.weekday = new Date(startsAt).getDay();
    }

    if (normalized.weekOfMonth === null || normalized.weekOfMonth === undefined) {
      const day = new Date(startsAt).getDate();
      normalized.weekOfMonth = Math.min(4, Math.ceil(day / 7));
    }
  }

  return normalized;
};

const getNextRecurringOccurrenceStart = (event, referenceAt) => {
  const startsAt = new Date(event.startsAt);
  const recurrence = normalizeRecurrence(event.recurrence, startsAt);
  const reference = new Date(referenceAt);
  const until = recurrence.endsOn ? endOfDay(recurrence.endsOn) : null;

  if (until && reference > until) {
    return null;
  }

  if (recurrence.type === "none") {
    return startsAt >= reference ? startsAt : null;
  }

  if (recurrence.type === "weekly") {
    const interval = Math.max(1, recurrence.interval);
    const days = recurrence.daysOfWeek.length
      ? recurrence.daysOfWeek
      : [startsAt.getDay()];
    const dayReference = startOfDay(reference > startsAt ? reference : startsAt);

    for (let offset = 0; offset < 370; offset += 1) {
      const day = addDays(dayReference, offset);

      if (!days.includes(day.getDay())) {
        continue;
      }

      const weekDiff = Math.floor(
        (startOfDay(day).getTime() - startOfDay(startsAt).getTime()) /
          (7 * DAY_MS),
      );

      if (weekDiff < 0 || weekDiff % interval !== 0) {
        continue;
      }

      const candidate = withBaseTime(day, startsAt);

      if (candidate < startsAt || candidate < reference) {
        continue;
      }

      if (until && candidate > until) {
        return null;
      }

      return candidate;
    }

    return null;
  }

  if (recurrence.type === "monthly-day") {
    const interval = Math.max(1, recurrence.interval);
    const dayOfMonth = recurrence.dayOfMonth || startsAt.getDate();
    const monthReference = reference > startsAt ? reference : startsAt;
    const baseMonthIndex = toMonthIndex(startsAt);

    for (let offset = 0; offset < 120; offset += 1) {
      const monthDate = addMonths(new Date(monthReference.getFullYear(), monthReference.getMonth(), 1), offset);
      const monthIndex = toMonthIndex(monthDate);
      const diff = monthIndex - baseMonthIndex;

      if (diff < 0 || diff % interval !== 0) {
        continue;
      }

      const day = Math.min(
        dayOfMonth,
        getDaysInMonth(monthDate.getFullYear(), monthDate.getMonth()),
      );
      const candidate = withBaseTime(
        new Date(monthDate.getFullYear(), monthDate.getMonth(), day),
        startsAt,
      );

      if (candidate < startsAt || candidate < reference) {
        continue;
      }

      if (until && candidate > until) {
        return null;
      }

      return candidate;
    }

    return null;
  }

  if (recurrence.type === "monthly-weekday") {
    const interval = Math.max(1, recurrence.interval);
    const weekday =
      recurrence.weekday !== null && recurrence.weekday !== undefined
        ? recurrence.weekday
        : startsAt.getDay();
    const weekOfMonth =
      recurrence.weekOfMonth !== null && recurrence.weekOfMonth !== undefined
        ? recurrence.weekOfMonth
        : Math.min(4, Math.ceil(startsAt.getDate() / 7));

    const monthReference = reference > startsAt ? reference : startsAt;
    const baseMonthIndex = toMonthIndex(startsAt);

    for (let offset = 0; offset < 120; offset += 1) {
      const monthDate = addMonths(new Date(monthReference.getFullYear(), monthReference.getMonth(), 1), offset);
      const monthIndex = toMonthIndex(monthDate);
      const diff = monthIndex - baseMonthIndex;

      if (diff < 0 || diff % interval !== 0) {
        continue;
      }

      const dayDate = getNthWeekdayOfMonth(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        weekday,
        weekOfMonth,
      );

      if (!dayDate) {
        continue;
      }

      const candidate = withBaseTime(dayDate, startsAt);

      if (candidate < startsAt || candidate < reference) {
        continue;
      }

      if (until && candidate > until) {
        return null;
      }

      return candidate;
    }
  }

  return null;
};

const resolveOccurrenceWindow = (event, referenceAt) => {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const duration = Math.max(1, endsAt.getTime() - startsAt.getTime());

  if (normalizeRecurrence(event.recurrence, startsAt).type === "none") {
    return {
      startsAt,
      endsAt,
    };
  }

  const nextStart = getNextRecurringOccurrenceStart(event, referenceAt);

  if (!nextStart) {
    return null;
  }

  return {
    startsAt: nextStart,
    endsAt: new Date(nextStart.getTime() + duration),
  };
};

const applyEventFilters = ({
  events,
  now,
  filter,
  sort,
  from,
  to,
}) => {
  const rangeStart = from ? new Date(from) : null;
  const rangeEnd = to ? new Date(to) : null;

  let monthRangeStart = null;
  let monthRangeEnd = null;

  if (filter === "this-month") {
    monthRangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthRangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const filtered = [];

  for (const event of events) {
    const referenceAt = rangeStart || monthRangeStart || now;
    const occurrence = resolveOccurrenceWindow(event, referenceAt);

    if (!occurrence) {
      continue;
    }

    if (filter === "upcoming" && occurrence.endsAt < now) {
      continue;
    }

    if (monthRangeStart && monthRangeEnd) {
      if (occurrence.startsAt > monthRangeEnd || occurrence.endsAt < monthRangeStart) {
        continue;
      }
    }

    if (rangeStart && occurrence.endsAt < rangeStart) {
      continue;
    }

    if (rangeEnd && occurrence.startsAt > rangeEnd) {
      continue;
    }

    filtered.push({
      event,
      occurrence,
    });
  }

  filtered.sort((a, b) => {
    if (sort === "newest") {
      return new Date(b.event.createdAt).getTime() - new Date(a.event.createdAt).getTime();
    }

    if (sort === "dateDesc") {
      return b.occurrence.startsAt.getTime() - a.occurrence.startsAt.getTime();
    }

    return a.occurrence.startsAt.getTime() - b.occurrence.startsAt.getTime();
  });

  return filtered;
};

const getEventTicketStatsMap = async (eventIds) => {
  if (!eventIds.length) {
    return new Map();
  }

  const rows = await EventTicket.aggregate([
    {
      $match: {
        eventId: { $in: eventIds },
        status: { $in: ["pending", "paid", "used"] },
      },
    },
    {
      $group: {
        _id: {
          eventId: "$eventId",
          status: "$status",
        },
        quantity: { $sum: "$quantity" },
      },
    },
  ]);

  const map = new Map();

  for (const row of rows) {
    const eventId = String(row._id.eventId);
    const entry = map.get(eventId) || {
      soldTickets: 0,
      pendingTickets: 0,
    };

    if (row._id.status === "pending") {
      entry.pendingTickets += Number(row.quantity || 0);
    } else {
      entry.soldTickets += Number(row.quantity || 0);
    }

    map.set(eventId, entry);
  }

  return map;
};

const getMyTicketMap = async (eventIds, userId) => {
  if (!eventIds.length) {
    return new Map();
  }

  const rows = await EventTicket.find({
    eventId: { $in: eventIds },
    buyerUserId: userId,
    status: { $in: ["pending", "paid", "used"] },
  })
    .sort({ createdAt: -1 })
    .select("eventId status ticketCode paidAt paymentReference")
    .lean();

  const map = new Map();

  for (const row of rows) {
    const eventId = String(row.eventId);

    if (!map.has(eventId)) {
      map.set(eventId, row);
    }
  }

  return map;
};

const mapEventForResponse = ({ event, occurrence, stats, myTicket }) => {
  const soldTickets = Number(stats?.soldTickets || 0);
  const pendingTickets = Number(stats?.pendingTickets || 0);
  const reserved = soldTickets + pendingTickets;

  return {
    ...event.toJSON(),
    nextOccurrenceAt: occurrence.startsAt.toISOString(),
    nextOccurrenceEndsAt: occurrence.endsAt.toISOString(),
    soldTickets,
    pendingTickets,
    remainingTickets: Math.max(0, Number(event.expectedTickets || 0) - reserved),
    myTicket: myTicket
      ? {
          _id: String(myTicket._id),
          status: myTicket.status,
          ticketCode: myTicket.ticketCode,
          paidAt: myTicket.paidAt,
          paymentReference: myTicket.paymentReference,
        }
      : null,
  };
};

const toIdString = (value) => String(value?._id || value || "");

const ensureEventCanBeManagedBy = async (event, userId) => {
  if (toIdString(event.organizerUserId) === toIdString(userId)) {
    return;
  }

  if (!event.workspaceId) {
    throw new ApiError(403, "You cannot manage this event");
  }

  const membership = await Membership.findOne({
    workspaceId: event.workspaceId,
    userId,
    status: "active",
  });

  if (!membership || roleWeight[membership.role] < roleWeight.admin) {
    throw new ApiError(403, "You cannot manage this event");
  }
};

const buildTicketCode = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entropy = Math.random().toString(36).slice(2, 7).toUpperCase();
    const stamp = Date.now().toString(36).toUpperCase();
    const code = `VRA-${stamp}-${entropy}`;

    const exists = await EventTicket.exists({ ticketCode: code });

    if (!exists) {
      return code;
    }
  }

  throw new ApiError(500, "Could not generate ticket code");
};

const isDuplicateKeyError = (error) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  return Number(error.code) === 11000;
};

const parsePaystackEnvelope = async (response) => {
  const rawText = await response.text();

  if (!rawText) {
    return {
      payload: null,
      rawText: null,
    };
  }

  try {
    return {
      payload: JSON.parse(rawText),
      rawText,
    };
  } catch (_error) {
    return {
      payload: null,
      rawText,
    };
  }
};

const paystackRequest = async (path, { method = "GET", body } = {}) => {
  if (!env.paystackSecretKey) {
    throw new ApiError(503, "PAYSTACK_SECRET_KEY is not configured");
  }

  const url = `${env.paystackBaseUrl}${path}`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ApiError(502, "Could not reach Paystack", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const { payload, rawText } = await parsePaystackEnvelope(response);

  if (!response.ok) {
    throw new ApiError(502, "Paystack request failed", {
      statusCode: response.status,
      payload,
      rawText,
    });
  }

  if (!payload || payload.status !== true || !payload.data) {
    throw new ApiError(502, "Invalid Paystack response", {
      payload,
      rawText,
    });
  }

  return payload.data;
};

const createEvent = async ({ actorUserId, payload }) => {
  const organizer = await User.findById(actorUserId);

  if (!organizer) {
    throw new ApiError(404, "Organizer account not found");
  }

  let workspace = null;

  if (payload.workspaceId) {
    workspace = await requireWorkspaceAdmin(payload.workspaceId, actorUserId);
  }

  const startsAt = new Date(payload.startsAt);
  const recurrence = normalizeRecurrence(payload.recurrence, startsAt);

  return Event.create({
    organizerUserId: actorUserId,
    workspaceId: workspace?._id ?? null,
    name: payload.name,
    description: payload.description || "",
    imageUrl: payload.imageUrl || "",
    address: payload.address,
    latitude: payload.latitude,
    longitude: payload.longitude,
    geofenceRadiusMeters: payload.geofenceRadiusMeters,
    startsAt,
    endsAt: new Date(payload.endsAt),
    timezone: payload.timezone || "Africa/Lagos",
    isPaid: payload.isPaid,
    ticketPriceNaira: payload.isPaid ? payload.ticketPriceNaira : 0,
    currency: "NGN",
    expectedTickets: payload.expectedTickets,
    recurrence,
    status: payload.status || "published",
  });
};

const listEvents = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
  sort = "dateAsc",
  filter = "upcoming",
  from,
  to,
  ticketType = "all",
  workspaceId,
}) => {
  const query = {
    status: "published",
  };

  if (workspaceId) {
    const workspace = await resolveWorkspaceByRef(workspaceId);
    query.workspaceId = workspace._id;
  }

  if (ticketType === "free") {
    query.isPaid = false;
  }

  if (ticketType === "paid") {
    query.isPaid = true;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
    query.$or = [
      { name: pattern },
      { description: pattern },
      { address: pattern },
    ];
  }

  const rawItems = await Event.find(query)
    .populate("organizerUserId", "fullName email avatarUrl title")
    .populate("workspaceId", "name slug")
    .sort({ createdAt: -1 });

  const now = new Date();
  const filtered = applyEventFilters({
    events: rawItems,
    now,
    filter,
    sort,
    from,
    to,
  });

  const totalItems = filtered.length;
  const skip = (page - 1) * limit;
  const paged = filtered.slice(skip, skip + limit);

  const eventIds = paged.map((item) => item.event._id);
  const [statsMap, myTicketMap] = await Promise.all([
    getEventTicketStatsMap(eventIds),
    getMyTicketMap(eventIds, actorUserId),
  ]);

  const items = paged.map((entry) => {
    const key = String(entry.event._id);

    return mapEventForResponse({
      event: entry.event,
      occurrence: entry.occurrence,
      stats: statsMap.get(key),
      myTicket: myTicketMap.get(key),
    });
  });

  return {
    items,
    ...buildPaginationMeta({ page, limit, totalItems }),
  };
};

const listMyEvents = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
  status = "all",
}) => {
  const query = {
    organizerUserId: actorUserId,
  };

  if (status !== "all") {
    query.status = status;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
    query.$or = [
      { name: pattern },
      { description: pattern },
      { address: pattern },
    ];
  }

  const skip = (page - 1) * limit;

  const [events, totalItems] = await Promise.all([
    Event.find(query)
      .populate("organizerUserId", "fullName email avatarUrl title")
      .populate("workspaceId", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Event.countDocuments(query),
  ]);

  const now = new Date();
  const eventIds = events.map((event) => event._id);
  const statsMap = await getEventTicketStatsMap(eventIds);

  const items = events.map((event) => {
    const occurrence = resolveOccurrenceWindow(event, now) || {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
    };

    return mapEventForResponse({
      event,
      occurrence,
      stats: statsMap.get(String(event._id)),
      myTicket: null,
    });
  });

  return {
    items,
    ...buildPaginationMeta({ page, limit, totalItems }),
  };
};

const getEventById = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId)
    .populate("organizerUserId", "fullName email avatarUrl title")
    .populate("workspaceId", "name slug");

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (event.status !== "published" && String(event.organizerUserId?._id || event.organizerUserId) !== String(actorUserId)) {
    await ensureEventCanBeManagedBy(event, actorUserId);
  }

  const now = new Date();
  const occurrence = resolveOccurrenceWindow(event, now) || {
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
  };

  const [statsMap, myTickets] = await Promise.all([
    getEventTicketStatsMap([event._id]),
    EventTicket.find({
      eventId,
      buyerUserId: actorUserId,
      status: { $in: ["pending", "paid", "used", "cancelled"] },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("usedByUserId", "fullName email avatarUrl title"),
  ]);

  return {
    event: mapEventForResponse({
      event,
      occurrence,
      stats: statsMap.get(String(event._id)),
      myTicket: myTickets[0] || null,
    }),
    myTickets,
  };
};

const updateEvent = async ({
  eventId,
  actorUserId,
  payload,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeManagedBy(event, actorUserId);

  if (payload.startsAt && !payload.endsAt) {
    const startsAt = new Date(payload.startsAt);

    if (startsAt >= new Date(event.endsAt)) {
      throw new ApiError(400, "startsAt must be before endsAt");
    }
  }

  if (payload.endsAt && !payload.startsAt) {
    const endsAt = new Date(payload.endsAt);

    if (endsAt <= new Date(event.startsAt)) {
      throw new ApiError(400, "endsAt must be later than startsAt");
    }
  }

  if (payload.startsAt && payload.endsAt) {
    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);

    if (startsAt >= endsAt) {
      throw new ApiError(400, "endsAt must be later than startsAt");
    }
  }

  if (payload.isPaid === false) {
    payload.ticketPriceNaira = 0;
  }

  if (payload.isPaid === true && payload.ticketPriceNaira !== undefined && payload.ticketPriceNaira <= 0) {
    throw new ApiError(400, "Paid events require ticketPriceNaira greater than 0");
  }

  Object.assign(event, payload);

  if (payload.recurrence) {
    event.recurrence = normalizeRecurrence(
      payload.recurrence,
      payload.startsAt ? new Date(payload.startsAt) : new Date(event.startsAt),
    );
  }

  await event.save();

  return event;
};

const deleteEvent = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeManagedBy(event, actorUserId);

  const activeTickets = await EventTicket.countDocuments({
    eventId: event._id,
    status: { $in: ["pending", "paid", "used"] },
  });

  if (activeTickets > 0) {
    throw new ApiError(
      409,
      "This event already has active tickets. Cancel it instead of deleting.",
    );
  }

  await Promise.all([
    Event.deleteOne({ _id: event._id }),
    EventTicket.deleteMany({ eventId: event._id }),
  ]);

  return {
    eventId: String(event._id),
    deleted: true,
  };
};

const countReservedTickets = async (eventId) => {
  const pendingCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const rows = await EventTicket.aggregate([
    {
      $match: {
        eventId,
        $or: [
          { status: { $in: ["paid", "used"] } },
          { status: "pending", createdAt: { $gte: pendingCutoff } },
        ],
      },
    },
    {
      $group: {
        _id: null,
        quantity: { $sum: "$quantity" },
      },
    },
  ]);

  return Number(rows[0]?.quantity || 0);
};

const initializeTicketPurchase = async ({
  eventId,
  actorUserId,
  payload,
}) => {
  const [event, buyer] = await Promise.all([
    Event.findById(eventId),
    User.findById(actorUserId),
  ]);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (!buyer) {
    throw new ApiError(404, "Buyer account not found");
  }

  if (event.status !== "published") {
    throw new ApiError(409, "Only published events can issue tickets");
  }

  const occurrence = resolveOccurrenceWindow(event, new Date());

  if (!occurrence) {
    throw new ApiError(409, "This event has no available upcoming occurrence");
  }

  const quantity = Number(payload.quantity || 1);
  const reserved = await countReservedTickets(event._id);

  if (reserved + quantity > Number(event.expectedTickets || 0)) {
    throw new ApiError(409, "Ticket capacity has been reached");
  }

  const unitPriceNaira = event.isPaid ? Number(event.ticketPriceNaira || 0) : 0;
  const totalPriceNaira = unitPriceNaira * quantity;
  const attendeeEmail = String(payload.email || buyer.email || "").trim().toLowerCase();

  if (!attendeeEmail) {
    throw new ApiError(400, "Attendee email is required");
  }

  const shouldBypassPaystack =
    event.isPaid && !env.paystackSecretKey && env.paystackDevBypass;

  if (event.isPaid && !env.paystackSecretKey && !shouldBypassPaystack) {
    throw new ApiError(
      503,
      "Paid checkout is not configured yet. Set PAYSTACK_SECRET_KEY.",
    );
  }

  let baseTicket = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ticketCode = await buildTicketCode();
    const barcodeValue = JSON.stringify({
      provider: "vera",
      ticketCode,
      eventId: String(event._id),
    });

    try {
      baseTicket = await EventTicket.create({
        eventId: event._id,
        workspaceId: event.workspaceId || null,
        organizerUserId: event.organizerUserId,
        buyerUserId: actorUserId,
        quantity,
        unitPriceNaira,
        totalPriceNaira,
        currency: "NGN",
        status: event.isPaid && !shouldBypassPaystack ? "pending" : "paid",
        paymentProvider: event.isPaid && !shouldBypassPaystack ? "paystack" : "none",
        attendeeName: String(payload.attendeeName || buyer.fullName || "").trim(),
        attendeeEmail,
        ticketCode,
        barcodeValue,
        paidAt: event.isPaid && !shouldBypassPaystack ? null : new Date(),
        verifiedAt: event.isPaid && !shouldBypassPaystack ? null : new Date(),
      });
      break;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const duplicateFields = Object.keys(error.keyPattern || {});
      const duplicateMessage = String(error.message || "").toLowerCase();
      const isTicketCodeDuplicate =
        duplicateFields.includes("ticketCode") ||
        duplicateMessage.includes("ticketcode");

      if (isTicketCodeDuplicate) {
        continue;
      }

      throw new ApiError(409, "Could not issue ticket due to duplicate data");
    }
  }

  if (!baseTicket) {
    throw new ApiError(500, "Could not issue ticket. Please try again.");
  }

  if (!event.isPaid || shouldBypassPaystack) {
    return {
      requiresPayment: false,
      ticket: baseTicket,
      payment: null,
    };
  }

  const callbackUrl = payload.callbackUrl || env.paystackCallbackUrl || undefined;
  const paystackAmountKobo = Math.round(totalPriceNaira * 100);

  const metadata = {
    source: "vera-mobile",
    ticketId: String(baseTicket._id),
    eventId: String(event._id),
    buyerUserId: String(actorUserId),
    quantity,
  };

  let paymentData;

  try {
    paymentData = await paystackRequest("/transaction/initialize", {
      method: "POST",
      body: {
        email: attendeeEmail,
        amount: paystackAmountKobo,
        currency: "NGN",
        callback_url: callbackUrl,
        metadata,
      },
    });
  } catch (error) {
    baseTicket.status = "cancelled";
    baseTicket.cancelledAt = new Date();
    baseTicket.paymentMetadata = {
      ...(baseTicket.paymentMetadata || {}),
      initializeError:
        error instanceof Error ? error.message : String(error),
    };
    await baseTicket.save();
    throw error;
  }

  const paystackReference = String(paymentData.reference || "").trim();

  if (!paystackReference) {
    baseTicket.status = "cancelled";
    baseTicket.cancelledAt = new Date();
    baseTicket.paymentMetadata = {
      ...(baseTicket.paymentMetadata || {}),
      initializePayload: paymentData,
      initializeError: "Missing payment reference from Paystack",
    };
    await baseTicket.save();
    throw new ApiError(502, "Paystack did not return a valid payment reference");
  }

  baseTicket.paymentReference = paystackReference;
  baseTicket.paymentAuthorizationUrl = String(
    paymentData.authorization_url || "",
  ).trim();
  baseTicket.paymentAccessCode = String(paymentData.access_code || "").trim();
  baseTicket.paymentMetadata = {
    ...(baseTicket.paymentMetadata || {}),
    initializePayload: paymentData,
  };
  await baseTicket.save();

  return {
    requiresPayment: true,
    ticket: baseTicket,
    payment: {
      reference: baseTicket.paymentReference,
      authorizationUrl: baseTicket.paymentAuthorizationUrl,
      accessCode: baseTicket.paymentAccessCode,
    },
  };
};

const verifyTicketPayment = async ({
  ticketId,
  actorUserId,
  reference,
}) => {
  const ticket = await EventTicket.findById(ticketId).populate("eventId");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  if (String(ticket.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only verify your own ticket");
  }

  if (ticket.status === "paid" || ticket.status === "used") {
    return {
      ticket,
      paymentStatus: "success",
      alreadyVerified: true,
    };
  }

  if (ticket.paymentProvider !== "paystack") {
    throw new ApiError(409, "This ticket does not require online payment verification");
  }

  const paymentReference = String(reference || ticket.paymentReference || "").trim();

  if (!paymentReference) {
    throw new ApiError(400, "Payment reference is required for verification");
  }

  const paymentData = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(paymentReference)}`,
  );

  const paidStatus = String(paymentData.status || "").toLowerCase();

  if (paidStatus !== "success") {
    throw new ApiError(402, "Payment has not been completed", {
      paymentStatus: paidStatus,
    });
  }

  const amountKobo = Number(paymentData.amount || 0);
  const expectedKobo = Math.round(Number(ticket.totalPriceNaira || 0) * 100);

  if (amountKobo < expectedKobo) {
    throw new ApiError(409, "Paid amount is below the expected ticket amount", {
      amountKobo,
      expectedKobo,
    });
  }

  ticket.status = "paid";
  ticket.paidAt = ticket.paidAt || new Date();
  ticket.verifiedAt = new Date();
  ticket.paymentReference = paymentReference;
  ticket.paymentMetadata = {
    ...(ticket.paymentMetadata || {}),
    verifyPayload: paymentData,
  };
  await ticket.save();

  return {
    ticket,
    paymentStatus: paidStatus,
    alreadyVerified: false,
  };
};

const toCheckInWindow = (event, now) => {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const duration = Math.max(1, endsAt.getTime() - startsAt.getTime());
  const referenceAt = new Date(now.getTime() - duration);
  const occurrence = resolveOccurrenceWindow(event, referenceAt) || {
    startsAt,
    endsAt,
  };
  const earlyGraceMs = 3 * 60 * 60 * 1000;
  const lateGraceMs = 8 * 60 * 60 * 1000;

  return {
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    opensAt: new Date(occurrence.startsAt.getTime() - earlyGraceMs),
    closesAt: new Date(occurrence.endsAt.getTime() + lateGraceMs),
  };
};

const parseTicketScanCode = (inputCode) => {
  const rawCode = String(inputCode || "").trim();

  if (!rawCode) {
    throw new ApiError(400, "Ticket code is required");
  }

  let ticketCode = rawCode;
  let parsedEventId = null;

  try {
    const parsed = JSON.parse(rawCode);

    if (parsed && typeof parsed === "object") {
      const maybeTicketCode = String(parsed.ticketCode || "").trim();
      const maybeEventId = String(parsed.eventId || "").trim();

      if (maybeTicketCode) {
        ticketCode = maybeTicketCode;
      }

      if (objectIdRegex.test(maybeEventId)) {
        parsedEventId = maybeEventId;
      }
    }
  } catch (_error) {
    // If it is not JSON, we treat the raw scan payload as a ticket code.
  }

  return {
    rawCode,
    ticketCode,
    parsedEventId,
  };
};

const checkInTicket = async ({ actorUserId, payload }) => {
  const parsed = parseTicketScanCode(payload.code);
  const requestedEventId = payload.eventId || parsed.parsedEventId || null;
  let ticketQuery = null;

  if (objectIdRegex.test(parsed.ticketCode)) {
    ticketQuery = { _id: parsed.ticketCode };
  } else if (/^VRA-/i.test(parsed.ticketCode)) {
    ticketQuery = {
      ticketCode: new RegExp(`^${escapeRegex(parsed.ticketCode)}$`, "i"),
    };
  } else {
    ticketQuery = {
      $or: [
        { ticketCode: new RegExp(`^${escapeRegex(parsed.ticketCode)}$`, "i") },
        { barcodeValue: parsed.rawCode },
      ],
    };
  }

  const ticket = await EventTicket.findOne(ticketQuery)
    .populate("eventId")
    .populate("buyerUserId", "fullName email avatarUrl title")
    .populate("usedByUserId", "fullName email avatarUrl title");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  const event = ticket.eventId;

  if (!event) {
    throw new ApiError(404, "Event not found for this ticket");
  }

  if (requestedEventId && String(event._id) !== String(requestedEventId)) {
    throw new ApiError(409, "Scanned ticket does not belong to this event");
  }

  await ensureEventCanBeManagedBy(event, actorUserId);

  if (event.status !== "published") {
    throw new ApiError(409, "Only published events can check in attendees");
  }

  if (ticket.status === "cancelled" || ticket.status === "expired") {
    throw new ApiError(409, "This ticket is not active");
  }

  if (ticket.status === "pending") {
    throw new ApiError(409, "Ticket payment is still pending");
  }

  const now = new Date();
  const window = toCheckInWindow(event, now);

  if (now < window.opensAt || now > window.closesAt) {
    throw new ApiError(409, "Ticket check-in window is closed for this event", {
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      eventStartsAt: window.startsAt,
      eventEndsAt: window.endsAt,
    });
  }

  if (ticket.status === "used") {
    return {
      ticket,
      alreadyUsed: true,
      checkedInAt: ticket.usedAt,
    };
  }

  ticket.status = "used";
  ticket.usedAt = now;
  ticket.usedByUserId = actorUserId;
  ticket.verifiedAt = ticket.verifiedAt || now;
  await ticket.save();
  await ticket.populate("usedByUserId", "fullName email avatarUrl title");

  return {
    ticket,
    alreadyUsed: false,
    checkedInAt: ticket.usedAt,
  };
};

const listMyTickets = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
  status = "all",
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const query = {
    buyerUserId: actorUserId,
  };

  if (status !== "all") {
    query.status = status;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");

    const matchingEvents = await Event.find({
      $or: [
        { name: pattern },
        { address: pattern },
      ],
    })
      .select("_id")
      .limit(5000)
      .lean();

    const eventIds = matchingEvents.map((item) => item._id);

    query.$or = [
      { ticketCode: pattern },
      { attendeeEmail: pattern },
      { attendeeName: pattern },
    ];

    if (eventIds.length) {
      query.$or.push({ eventId: { $in: eventIds } });
    }
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    EventTicket.find(query)
      .populate({
        path: "eventId",
        select:
          "organizerUserId name imageUrl address latitude longitude geofenceRadiusMeters startsAt endsAt timezone isPaid ticketPriceNaira currency expectedTickets recurrence status createdAt updatedAt",
        populate: {
          path: "organizerUserId",
          select: "fullName email avatarUrl title",
        },
      })
      .populate("usedByUserId", "fullName email avatarUrl title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),
    EventTicket.countDocuments(query),
  ]);

  const now = new Date();
  const normalizedItems = items.map((ticket) => {
    if (
      !ticket.eventId ||
      typeof ticket.eventId !== "object" ||
      !("startsAt" in ticket.eventId) ||
      !("endsAt" in ticket.eventId)
    ) {
      return ticket;
    }

    const event = ticket.eventId;
    const occurrence = resolveOccurrenceWindow(event, now) || {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
    };

    return {
      ...ticket,
      eventId: {
        ...event,
        nextOccurrenceAt: occurrence.startsAt,
        nextOccurrenceEndsAt: occurrence.endsAt,
      },
    };
  });

  return {
    items: normalizedItems,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const getTicketById = async ({ ticketId, actorUserId }) => {
  const ticket = await EventTicket.findById(ticketId)
    .populate({
      path: "eventId",
      populate: {
        path: "organizerUserId",
        select: "fullName email avatarUrl title",
      },
    })
    .populate("usedByUserId", "fullName email avatarUrl title");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  const isBuyer = String(ticket.buyerUserId) === String(actorUserId);
  const isOrganizer = String(ticket.organizerUserId) === String(actorUserId);

  if (!isBuyer && !isOrganizer) {
    throw new ApiError(403, "You cannot access this ticket");
  }

  return ticket;
};

const listEventTickets = async ({
  eventId,
  actorUserId,
  page = 1,
  limit = 20,
  search,
  status = "all",
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeManagedBy(event, actorUserId);

  const query = {
    eventId,
  };

  if (status !== "all") {
    query.status = status;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");

    query.$or = [
      { ticketCode: pattern },
      { attendeeName: pattern },
      { attendeeEmail: pattern },
    ];
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    EventTicket.find(query)
      .populate("buyerUserId", "fullName email title avatarUrl")
      .populate("usedByUserId", "fullName email title avatarUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    EventTicket.countDocuments(query),
  ]);

  return {
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

module.exports = {
  createEvent,
  listEvents,
  listMyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  initializeTicketPurchase,
  verifyTicketPayment,
  checkInTicket,
  listMyTickets,
  getTicketById,
  listEventTickets,
};
