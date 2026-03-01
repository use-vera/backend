const ApiError = require("../utils/api-error");
const mongoose = require("mongoose");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventRating = require("../models/event-rating.model");
const EventChatMessage = require("../models/event-chat-message.model");
const EventPost = require("../models/event-post.model");
const EventPostLike = require("../models/event-post-like.model");
const EventPostComment = require("../models/event-post-comment.model");
const EventReminderPreference = require("../models/event-reminder-preference.model");
const TicketResaleBid = require("../models/ticket-resale-bid.model");
const TicketTodo = require("../models/ticket-todo.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const User = require("../models/user.model");
const { normalizeMessagePayload } = require("../utils/chat-content");
const { createNotification } = require("./notification.service");
const {
  generatePaystackReference,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} = require("./paystack.service");
const env = require("../config/env");

const roleWeight = {
  member: 1,
  admin: 2,
  owner: 3,
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_OFFSETS = [1440, 180, 30];

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value)));

const toObjectIds = (values) =>
  values.map((value) => new mongoose.Types.ObjectId(String(value)));

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

const normalizeTicketCategories = ({
  categories,
  isPaid,
}) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    return [];
  }

  const seenNames = new Set();

  return categories.map((category, index) => {
    const name = String(category?.name || "").trim();

    if (!name) {
      throw new ApiError(400, `Ticket category ${index + 1} requires a name`);
    }

    const normalizedName = name.toLowerCase();

    if (seenNames.has(normalizedName)) {
      throw new ApiError(400, "Ticket category names must be unique");
    }

    seenNames.add(normalizedName);

    const quantity = Math.max(1, Math.round(Number(category?.quantity || 0)));
    const inputPrice = Math.max(0, Math.round(Number(category?.priceNaira || 0)));
    const priceNaira = isPaid ? inputPrice : 0;

    if (isPaid && priceNaira <= 0) {
      throw new ApiError(
        400,
        `Paid category "${name}" requires a price greater than 0`,
      );
    }

    const normalized = {
      name,
      description: String(category?.description || "").trim(),
      quantity,
      priceNaira,
    };

    const categoryId = String(category?.categoryId || category?._id || "").trim();

    if (objectIdRegex.test(categoryId)) {
      normalized._id = new mongoose.Types.ObjectId(categoryId);
    }

    return normalized;
  });
};

const getTicketCategoryTotals = (categories) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    return {
      expectedTickets: 0,
      baseTicketPriceNaira: 0,
    };
  }

  return {
    expectedTickets: categories.reduce(
      (sum, category) => sum + Math.max(1, Number(category.quantity || 0)),
      0,
    ),
    baseTicketPriceNaira: categories.reduce((min, category) => {
      const next = Math.max(0, Math.round(Number(category.priceNaira || 0)));

      if (min === null) {
        return next;
      }

      return Math.min(min, next);
    }, null),
  };
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

const getEventRatingsSummaryMap = async (eventIds, actorUserId) => {
  if (!eventIds.length) {
    return new Map();
  }

  const [summaryRows, myRatings] = await Promise.all([
    EventRating.aggregate([
      {
        $match: {
          eventId: { $in: eventIds },
        },
      },
      {
        $group: {
          _id: "$eventId",
          averageRating: { $avg: "$rating" },
          ratingsCount: { $sum: 1 },
        },
      },
    ]),
    actorUserId
      ? EventRating.find({
          eventId: { $in: eventIds },
          userId: actorUserId,
        })
          .select("eventId rating")
          .lean()
      : [],
  ]);

  const map = new Map();

  for (const row of summaryRows) {
    map.set(String(row._id), {
      averageRating: Number(row.averageRating || 0),
      ratingsCount: Number(row.ratingsCount || 0),
      myRating: null,
    });
  }

  for (const row of myRatings) {
    const key = String(row.eventId);
    const existing = map.get(key) || {
      averageRating: 0,
      ratingsCount: 0,
      myRating: null,
    };

    existing.myRating = Number(row.rating || 0);
    map.set(key, existing);
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

const getCoworkerTicketCountMap = async ({ eventIds, actorUserId }) => {
  if (!eventIds.length || !actorUserId) {
    return new Map();
  }

  const memberships = await Membership.find({
    userId: actorUserId,
    status: "active",
  })
    .select("workspaceId")
    .limit(1200)
    .lean();
  const workspaceIds = memberships.map((item) => item.workspaceId);

  if (!workspaceIds.length) {
    return new Map();
  }

  const coworkerRows = await Membership.find({
    workspaceId: { $in: workspaceIds },
    status: "active",
  })
    .select("userId")
    .limit(5000)
    .lean();

  const coworkerIds = [...new Set(
    coworkerRows
      .map((row) => String(row.userId))
      .filter((value) => objectIdRegex.test(value) && value !== String(actorUserId)),
  )];

  if (!coworkerIds.length) {
    return new Map();
  }

  const rows = await EventTicket.aggregate([
    {
      $match: {
        eventId: { $in: eventIds },
        buyerUserId: { $in: toObjectIds(coworkerIds) },
        status: { $in: ["pending", "paid", "used"] },
      },
    },
    {
      $group: {
        _id: "$eventId",
        quantity: { $sum: "$quantity" },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), Number(row.quantity || 0)]));
};

const getDynamicTicketPricing = ({ event, occurrence, soldTickets, pendingTickets, now }) => {
  const basePriceNaira = Number(event.ticketPriceNaira || 0);

  if (!event.isPaid || basePriceNaira <= 0) {
    return {
      currentTicketPriceNaira: 0,
      pricingInsight: null,
    };
  }

  const pricing = event.pricing || {};

  if (!pricing.dynamicEnabled) {
    return {
      currentTicketPriceNaira: basePriceNaira,
      pricingInsight: {
        strategy: "fixed",
        demandRatio: 0,
        multiplier: 1,
        suggestion: "Static pricing enabled",
      },
    };
  }

  const expectedTickets = Math.max(1, Number(event.expectedTickets || 1));
  const reserved = Math.max(0, soldTickets + pendingTickets);
  const demandRatio = clamp(reserved / expectedTickets, 0, 1.6);
  const minutesToStart = Math.max(
    0,
    Math.round((new Date(occurrence.startsAt).getTime() - now.getTime()) / 60000),
  );
  const timePressure = clamp(1 - minutesToStart / (14 * 24 * 60), 0, 1);
  const demandSignal = demandRatio * 0.75 + timePressure * 0.25;
  const demandSensitivity = clamp(Number(pricing.demandSensitivity || 1), 0.1, 3);
  const centeredSignal = (demandSignal - 0.5) * demandSensitivity;
  const rawMultiplier = 1 + centeredSignal;
  const minRatio = clamp(Number(pricing.discountFloorRatio || 0.8), 0.4, 1);
  const maxRatio = clamp(Number(pricing.surgeCapRatio || 1.6), 1, 3);
  const boundedMultiplier = clamp(rawMultiplier, minRatio, maxRatio);
  let currentTicketPriceNaira = Math.round(basePriceNaira * boundedMultiplier);

  const minPrice = Math.max(0, Number(pricing.minPriceNaira || 0));
  const maxPrice = Number(pricing.maxPriceNaira || 0);

  if (minPrice > 0) {
    currentTicketPriceNaira = Math.max(currentTicketPriceNaira, minPrice);
  }

  if (maxPrice > 0) {
    currentTicketPriceNaira = Math.min(currentTicketPriceNaira, maxPrice);
  }

  currentTicketPriceNaira = Math.max(0, Math.round(currentTicketPriceNaira));

  let suggestion = "Demand balanced. Keep current pricing.";

  if (demandRatio < 0.25 && minutesToStart > 7 * 24 * 60) {
    suggestion = "Slow demand. Push a discount campaign.";
  } else if (demandRatio > 0.8 && minutesToStart < 72 * 60) {
    suggestion = "High demand. Surge pricing is active.";
  } else if (demandRatio > 1) {
    suggestion = "Capacity pressure detected. Consider increasing venue size.";
  }

  return {
    currentTicketPriceNaira,
    pricingInsight: {
      strategy: "dynamic",
      demandRatio: Number(demandRatio.toFixed(2)),
      multiplier: Number((currentTicketPriceNaira / Math.max(1, basePriceNaira)).toFixed(2)),
      suggestion,
    },
  };
};

const mapEventForResponse = ({
  event,
  occurrence,
  stats,
  myTicket,
  ratings,
  organizerBadge,
  coworkerTicketCount = 0,
  now = new Date(),
}) => {
  const soldTickets = Number(stats?.soldTickets || 0);
  const pendingTickets = Number(stats?.pendingTickets || 0);
  const reserved = soldTickets + pendingTickets;
  const averageRating = Number(ratings?.averageRating || 0);
  const ratingsCount = Number(ratings?.ratingsCount || 0);
  const dynamicPricing = getDynamicTicketPricing({
    event,
    occurrence,
    soldTickets,
    pendingTickets,
    now,
  });

  return {
    ...event.toJSON(),
    nextOccurrenceAt: occurrence.startsAt.toISOString(),
    nextOccurrenceEndsAt: occurrence.endsAt.toISOString(),
    soldTickets,
    pendingTickets,
    remainingTickets: Math.max(0, Number(event.expectedTickets || 0) - reserved),
    averageRating,
    ratingsCount,
    currentTicketPriceNaira: dynamicPricing.currentTicketPriceNaira,
    pricingInsight: dynamicPricing.pricingInsight,
    organizerBadge: organizerBadge || null,
    friendsGoingCount: Number(coworkerTicketCount || 0),
    myRating:
      ratings?.myRating !== null && ratings?.myRating !== undefined
        ? Number(ratings.myRating)
        : null,
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

const ensureEventCanBeEditedBy = async (event, userId) => {
  if (toIdString(event.organizerUserId) !== toIdString(userId)) {
    throw new ApiError(403, "Only the event creator can edit or delete this event");
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
  const ticketCategories = normalizeTicketCategories({
    categories: payload.ticketCategories,
    isPaid: payload.isPaid,
  });
  const categoryTotals = getTicketCategoryTotals(ticketCategories);
  const expectedTickets =
    ticketCategories.length > 0
      ? categoryTotals.expectedTickets
      : payload.expectedTickets;
  const ticketPriceNaira = payload.isPaid
    ? ticketCategories.length > 0
      ? Math.max(0, Number(categoryTotals.baseTicketPriceNaira || 0))
      : payload.ticketPriceNaira
    : 0;

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
    ticketPriceNaira,
    currency: "NGN",
    expectedTickets,
    ticketCategories,
    recurrence,
    pricing: payload.pricing || undefined,
    resale: payload.resale || undefined,
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
  const organizerIds = paged.map((item) =>
    toIdString(item.event.organizerUserId),
  );
  const [statsMap, myTicketMap, ratingsMap, organizerBadgeMap, coworkerTicketMap] =
    await Promise.all([
      getEventTicketStatsMap(eventIds),
      getMyTicketMap(eventIds, actorUserId),
      getEventRatingsSummaryMap(eventIds, actorUserId),
      getOrganizerVerificationMap(organizerIds),
      getCoworkerTicketCountMap({ eventIds, actorUserId }),
    ]);

  const items = paged.map((entry) => {
    const key = String(entry.event._id);

    return mapEventForResponse({
      event: entry.event,
      occurrence: entry.occurrence,
      stats: statsMap.get(key),
      ratings: ratingsMap.get(key),
      myTicket: myTicketMap.get(key),
      organizerBadge: organizerBadgeMap.get(toIdString(entry.event.organizerUserId)),
      coworkerTicketCount: coworkerTicketMap.get(key) || 0,
      now,
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
  const organizerIds = events.map((event) => toIdString(event.organizerUserId));
  const [statsMap, ratingsMap, organizerBadgeMap, coworkerTicketMap] =
    await Promise.all([
      getEventTicketStatsMap(eventIds),
      getEventRatingsSummaryMap(eventIds, actorUserId),
      getOrganizerVerificationMap(organizerIds),
      getCoworkerTicketCountMap({ eventIds, actorUserId }),
    ]);

  const items = events.map((event) => {
    const occurrence = resolveOccurrenceWindow(event, now) || {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
    };

    return mapEventForResponse({
      event,
      occurrence,
      stats: statsMap.get(String(event._id)),
      ratings: ratingsMap.get(String(event._id)),
      myTicket: null,
      organizerBadge: organizerBadgeMap.get(toIdString(event.organizerUserId)),
      coworkerTicketCount: coworkerTicketMap.get(String(event._id)) || 0,
      now,
    });
  });

  return {
    items,
    ...buildPaginationMeta({ page, limit, totalItems }),
  };
};

const ensureEventCanBeViewedBy = async (event, actorUserId) => {
  if (
    event.status === "published" ||
    String(event.organizerUserId?._id || event.organizerUserId) ===
      String(actorUserId)
  ) {
    return;
  }

  await ensureEventCanBeManagedBy(event, actorUserId);
};

const getOrganizerVerificationMap = async (organizerIds) => {
  const normalizedIds = [...new Set(
    organizerIds
      .map((id) => String(id || "").trim())
      .filter((id) => objectIdRegex.test(id)),
  )];

  if (!normalizedIds.length) {
    return new Map();
  }

  const objectIds = toObjectIds(normalizedIds);

  const [eventStatsRows, attendeeRows, ratingRows] = await Promise.all([
    Event.aggregate([
      {
        $match: {
          organizerUserId: { $in: objectIds },
        },
      },
      {
        $group: {
          _id: "$organizerUserId",
          hostedEventsCount: { $sum: 1 },
          publishedCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "published"] }, 1, 0],
            },
          },
          cancelledCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
            },
          },
        },
      },
    ]),
    EventTicket.aggregate([
      {
        $match: {
          organizerUserId: { $in: objectIds },
          status: { $in: ["paid", "used"] },
        },
      },
      {
        $group: {
          _id: "$organizerUserId",
          attendees: { $sum: "$quantity" },
        },
      },
    ]),
    EventRating.aggregate([
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      {
        $match: {
          "event.organizerUserId": { $in: objectIds },
        },
      },
      {
        $group: {
          _id: "$event.organizerUserId",
          averageRating: { $avg: "$rating" },
          ratingsCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const eventStatsMap = new Map(
    eventStatsRows.map((row) => [
      String(row._id),
      {
        hostedEventsCount: Number(row.hostedEventsCount || 0),
        publishedCount: Number(row.publishedCount || 0),
        cancelledCount: Number(row.cancelledCount || 0),
      },
    ]),
  );
  const attendeeMap = new Map(
    attendeeRows.map((row) => [String(row._id), Number(row.attendees || 0)]),
  );
  const ratingMap = new Map(
    ratingRows.map((row) => [
      String(row._id),
      {
        averageRating: Number(row.averageRating || 0),
        ratingsCount: Number(row.ratingsCount || 0),
      },
    ]),
  );

  const result = new Map();

  for (const organizerId of normalizedIds) {
    const eventStats = eventStatsMap.get(organizerId) || {
      hostedEventsCount: 0,
      publishedCount: 0,
      cancelledCount: 0,
    };
    const attendees = Number(attendeeMap.get(organizerId) || 0);
    const ratingStats = ratingMap.get(organizerId) || {
      averageRating: 0,
      ratingsCount: 0,
    };
    const cancellationRate =
      eventStats.hostedEventsCount > 0
        ? eventStats.cancelledCount / eventStats.hostedEventsCount
        : 1;

    const score =
      Number(eventStats.publishedCount >= 3) +
      Number(attendees >= 80) +
      Number(ratingStats.ratingsCount >= 8 && ratingStats.averageRating >= 4.2) +
      Number(cancellationRate <= 0.25);

    const verified = score >= 3;
    const tier = verified && score >= 4 ? "elite" : verified ? "trusted" : null;

    result.set(organizerId, {
      verified,
      tier,
      score,
      hostedEventsCount: eventStats.hostedEventsCount,
      attendees,
      averageRating: Number(ratingStats.averageRating.toFixed(2)),
      ratingsCount: ratingStats.ratingsCount,
      cancellationRate: Number((cancellationRate * 100).toFixed(1)),
      rule: "published>=3, attendees>=80, rating>=4.2/8+, cancellation<=25%",
    });
  }

  return result;
};

const userHasEventTicket = async ({ eventId, userId }) => {
  if (!eventId || !userId) {
    return false;
  }

  const ticket = await EventTicket.exists({
    eventId,
    buyerUserId: userId,
    status: { $in: ["pending", "paid", "used"] },
  });

  return Boolean(ticket);
};

const ensureEventParticipant = async ({ event, actorUserId }) => {
  if (toIdString(event.organizerUserId) === toIdString(actorUserId)) {
    return;
  }

  if (await userHasEventTicket({ eventId: event._id, userId: actorUserId })) {
    return;
  }

  throw new ApiError(403, "Only attendees or organizers can access this action");
};

const normalizeEventResalePolicy = (event) => ({
  enabled: event?.resale?.enabled !== false,
  allowBids: event?.resale?.allowBids !== false,
  maxMarkupPercent: clamp(
    Number(event?.resale?.maxMarkupPercent ?? 25),
    0,
    100,
  ),
  bidWindowHours: clamp(
    Number(event?.resale?.bidWindowHours ?? 12),
    1,
    72,
  ),
});

const clearTicketResaleFields = async (ticketId, extraSet = {}) =>
  EventTicket.findByIdAndUpdate(
    ticketId,
    {
      $set: {
        resaleStatus: "none",
        resalePriceNaira: null,
        resaleQuantity: null,
        resaleAllowBids: false,
        resaleListedAt: null,
        acceptedBidId: null,
        acceptedBidExpiresAt: null,
        resaleBuyerUserId: null,
        ...extraSet,
      },
    },
    { new: true },
  );

const buildCheckoutPayment = (attempt) => ({
  reference: String(attempt?.reference || "").trim(),
  authorizationUrl: String(attempt?.authorizationUrl || "").trim(),
  accessCode: String(attempt?.accessCode || "").trim(),
});

const createPaymentAttemptForCheckout = async ({
  kind,
  buyerUserId,
  eventId,
  ticketId = null,
  resaleSourceTicketId = null,
  acceptedBidId = null,
  amountKobo,
  callbackUrl = "",
  email,
  metadata = {},
  referenceSuffix = "",
}) => {
  const reference = generatePaystackReference(kind, referenceSuffix);

  const attempt = await PaymentAttempt.create({
    reference,
    provider: "paystack",
    kind,
    buyerUserId,
    eventId,
    ticketId,
    resaleSourceTicketId,
    acceptedBidId,
    amountKobo: Math.max(1, Math.round(Number(amountKobo || 0))),
    currency: "NGN",
    callbackUrl: String(callbackUrl || "").trim(),
  });

  try {
    const paymentData = await initializePaystackTransaction({
      email,
      amountKobo: attempt.amountKobo,
      callbackUrl: attempt.callbackUrl || undefined,
      reference,
      metadata: {
        ...metadata,
        source: "vera-mobile",
        kind,
        paymentAttemptId: String(attempt._id),
      },
    });

    attempt.authorizationUrl = String(paymentData.authorization_url || "").trim();
    attempt.accessCode = String(paymentData.access_code || "").trim();
    attempt.paystackInitializePayload = paymentData;
    await attempt.save();

    return attempt;
  } catch (error) {
    attempt.status = "failed";
    attempt.failureReason =
      error instanceof Error ? error.message : String(error);
    attempt.fulfillmentStatus = "failed";
    await attempt.save();
    throw error;
  }
};

const markTicketPaidFromVerifiedPayment = async ({
  ticket,
  paymentReference,
  paymentData,
}) => {
  const amountKobo = Number(paymentData?.amount || 0);
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
  ticket.paymentProvider = "paystack";
  ticket.paymentReference = paymentReference;
  ticket.paymentMetadata = {
    ...(ticket.paymentMetadata || {}),
    verifyPayload: paymentData,
  };
  await ticket.save();

  return ticket;
};

const getPaymentAttemptForVerification = async ({
  reference,
  ticketId = null,
  kind,
}) => {
  const ref = String(reference || "").trim();

  if (ref) {
    const byReference = await PaymentAttempt.findOne({ reference: ref }).sort({
      createdAt: -1,
    });

    if (byReference) {
      return byReference;
    }
  }

  if (ticketId) {
    const query = kind
      ? { kind, $or: [{ ticketId }, { resaleSourceTicketId: ticketId }] }
      : { $or: [{ ticketId }, { resaleSourceTicketId: ticketId }] };

    return PaymentAttempt.findOne(query).sort({ createdAt: -1 });
  }

  return null;
};

const markPaymentAttemptVerified = async ({
  paymentAttempt,
  paymentData,
  fulfillmentTicketId,
}) => {
  if (!paymentAttempt) {
    return;
  }

  paymentAttempt.status = "success";
  paymentAttempt.paystackVerifyPayload = paymentData;
  paymentAttempt.fulfilledAt = paymentAttempt.fulfilledAt || new Date();
  paymentAttempt.fulfillmentStatus = "done";
  paymentAttempt.failureReason = "";
  paymentAttempt.fulfillmentTicketId = fulfillmentTicketId || null;
  await paymentAttempt.save();
};

const markPaymentAttemptFulfillmentFailed = async ({
  paymentAttempt,
  paymentData,
  reason,
}) => {
  if (!paymentAttempt) {
    return;
  }

  paymentAttempt.status = "success";
  paymentAttempt.paystackVerifyPayload = paymentData || paymentAttempt.paystackVerifyPayload;
  paymentAttempt.fulfillmentStatus = "failed";
  paymentAttempt.failureReason = String(reason || "").trim();
  await paymentAttempt.save();
};

const finalizeTicketPurchasePayment = async ({
  ticket,
  paymentAttempt = null,
  paymentReference,
  paymentData,
}) => {
  const wasAlreadyUsable = ticket.status === "paid" || ticket.status === "used";

  if (!wasAlreadyUsable) {
    await markTicketPaidFromVerifiedPayment({
      ticket,
      paymentReference,
      paymentData,
    });
  }

  await markPaymentAttemptVerified({
    paymentAttempt,
    paymentData,
    fulfillmentTicketId: ticket._id,
  });

  if (!wasAlreadyUsable) {
    void createNotification({
      userId: toIdString(ticket.buyerUserId),
      type: "ticket.purchase.completed",
      title: "Payment confirmed",
      message: "Your ticket is ready to use.",
      data: {
        target: "ticket-details",
        ticketId: String(ticket._id),
        eventId: toIdString(ticket.eventId),
      },
      push: true,
    }).catch(() => null);
  }

  return ticket;
};

const populateResaleTicketQuery = (query) =>
  query
    .populate("buyerUserId", "fullName email avatarUrl title")
    .populate("resaleBuyerUserId", "fullName email avatarUrl title")
    .populate("usedByUserId", "fullName email avatarUrl title")
    .populate({
      path: "eventId",
      populate: {
        path: "organizerUserId",
        select: "fullName email avatarUrl title",
      },
    });

const ensureOwnedTicket = async ({ ticketId, actorUserId }) => {
  const ticket = await populateResaleTicketQuery(EventTicket.findById(ticketId));

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  if (toIdString(ticket.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You do not own this ticket");
  }

  return ticket;
};

const expireAcceptedResaleOffer = async ({ ticket, now = new Date() }) => {
  if (
    !ticket ||
    ticket.resaleStatus !== "offer-accepted" ||
    !ticket.acceptedBidExpiresAt
  ) {
    return ticket;
  }

  const expiresAt = new Date(ticket.acceptedBidExpiresAt);

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > now.getTime()) {
    return ticket;
  }

  const acceptedBidId = toIdString(ticket.acceptedBidId);
  const sellerUserId = toIdString(ticket.buyerUserId);
  const acceptedBuyerUserId = toIdString(ticket.resaleBuyerUserId);

  if (acceptedBidId) {
    await TicketResaleBid.updateOne(
      {
        _id: acceptedBidId,
        status: "accepted",
      },
      {
        $set: {
          status: "expired",
          respondedAt: now,
        },
      },
    );
  }

  const refreshed = await EventTicket.findByIdAndUpdate(
    ticket._id,
    {
      $set: {
        resaleStatus: "listed",
        acceptedBidId: null,
        acceptedBidExpiresAt: null,
        resaleBuyerUserId: null,
      },
    },
    { new: true },
  );

  if (sellerUserId) {
    void createNotification({
      userId: sellerUserId,
      type: "ticket.resale.offer_expired",
      title: "Accepted bid expired",
      message:
        "The buyer did not complete payment in time. Your ticket is live again.",
      data: {
        target: "ticket-resale",
        ticketId: String(ticket._id),
        eventId: toIdString(ticket.eventId),
      },
      push: true,
    }).catch(() => null);
  }

  if (acceptedBuyerUserId) {
    void createNotification({
      userId: acceptedBuyerUserId,
      type: "ticket.resale.payment_expired",
      title: "Ticket payment window expired",
      message:
        "The 12-hour payment window closed. Place another bid if the listing is still available.",
      data: {
        target: "ticket-resale",
        ticketId: String(ticket._id),
        eventId: toIdString(ticket.eventId),
      },
      push: true,
    }).catch(() => null);
  }

  return refreshed || ticket;
};

const expireAcceptedResaleOfferById = async (ticketId, now = new Date()) => {
  const ticket = await EventTicket.findById(ticketId).select(
    "_id eventId buyerUserId resaleStatus acceptedBidId acceptedBidExpiresAt resaleBuyerUserId",
  );

  if (!ticket) {
    return null;
  }

  return expireAcceptedResaleOffer({ ticket, now });
};

const ensureTicketEligibleForResale = async ({ ticket, actorUserId }) => {
  if (toIdString(ticket.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "Only the current ticket owner can resell this ticket");
  }

  if (ticket.status !== "paid") {
    throw new ApiError(400, "Only paid unused tickets can be resold");
  }

  if (ticket.usedAt || ticket.status === "used") {
    throw new ApiError(400, "Used tickets cannot be resold");
  }

  const event =
    ticket.eventId && typeof ticket.eventId === "object"
      ? ticket.eventId
      : await Event.findById(ticket.eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const policy = normalizeEventResalePolicy(event);

  if (!policy.enabled) {
    throw new ApiError(403, "Ticket resale is disabled for this event");
  }

  return {
    event,
    policy,
  };
};

const formatResaleTicketForResponse = async (ticket, actorUserId) => {
  const payload = ticket?.toJSON ? ticket.toJSON() : ticket;

  if (!payload) {
    return null;
  }

  const [openBidsCount, highestOpenBid] = await Promise.all([
    TicketResaleBid.countDocuments({
      ticketId: payload._id,
      status: "open",
    }),
    TicketResaleBid.findOne({
      ticketId: payload._id,
      status: "open",
    })
      .sort({ amountNaira: -1, createdAt: 1 })
      .select("amountNaira bidderUserId"),
  ]);

  const myBid = actorUserId
    ? await TicketResaleBid.findOne({
        ticketId: payload._id,
        bidderUserId: actorUserId,
        status: { $in: ["open", "accepted"] },
      })
        .sort({ createdAt: -1 })
        .select("amountNaira status expiresAt")
        .lean()
    : null;

  return {
    ...payload,
    resaleQuantity: Number(payload.resaleQuantity || 1),
    openBidsCount: Number(openBidsCount || 0),
    highestBidNaira: Number(highestOpenBid?.amountNaira || 0),
    myBid: myBid
      ? {
          amountNaira: Number(myBid.amountNaira || 0),
          status: myBid.status,
          expiresAt: myBid.expiresAt || null,
        }
      : null,
  };
};

const getPostLikeMapForActor = async ({ postIds, actorUserId }) => {
  if (!Array.isArray(postIds) || !postIds.length || !actorUserId) {
    return new Set();
  }

  const rows = await EventPostLike.find({
    postId: { $in: postIds },
    userId: actorUserId,
  })
    .select("postId")
    .lean();

  return new Set(rows.map((row) => String(row.postId)));
};

const mapEventPostForResponse = ({ post, likedByMe = false }) => {
  const payload = post.toJSON ? post.toJSON() : post;

  return {
    ...payload,
    likesCount: Number(payload.likesCount || 0),
    commentsCount: Number(payload.commentsCount || 0),
    likedByMe: Boolean(likedByMe),
  };
};

const getPostWithAccess = async ({ postId, actorUserId, requireParticipant = false }) => {
  const post = await EventPost.findById(postId)
    .populate("authorUserId", "fullName email avatarUrl title")
    .populate("eventId", "name imageUrl address organizerUserId status");

  if (!post || !post.eventId) {
    throw new ApiError(404, "Post not found");
  }

  const event = post.eventId;
  await ensureEventCanBeViewedBy(event, actorUserId);

  const isParticipant =
    toIdString(event.organizerUserId) === String(actorUserId) ||
    (await userHasEventTicket({
      eventId: event._id,
      userId: actorUserId,
    }));

  if (post.visibility === "ticket-holders" && !isParticipant) {
    throw new ApiError(403, "This post is only available to ticket holders");
  }

  if (requireParticipant && !isParticipant) {
    throw new ApiError(403, "Only attendees or organizers can perform this action");
  }

  return {
    post,
    event,
    isParticipant,
  };
};

const listFeaturedEvents = async ({
  actorUserId,
  limit = 8,
  workspaceId,
}) => {
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 8));
  const query = {
    status: "published",
  };

  if (workspaceId) {
    const workspace = await resolveWorkspaceByRef(workspaceId);
    query.workspaceId = workspace._id;
  }

  const rawItems = await Event.find(query)
    .populate("organizerUserId", "fullName email avatarUrl title")
    .populate("workspaceId", "name slug")
    .sort({ createdAt: -1 })
    .limit(140);

  const now = new Date();
  const filtered = applyEventFilters({
    events: rawItems,
    now,
    filter: "upcoming",
    sort: "dateAsc",
  });

  const eventIds = filtered.map((item) => item.event._id);
  const organizerIds = filtered.map((item) =>
    toIdString(item.event.organizerUserId),
  );
  const [statsMap, ratingsMap, myTicketMap, organizerBadgeMap, coworkerTicketMap] =
    await Promise.all([
      getEventTicketStatsMap(eventIds),
      getEventRatingsSummaryMap(eventIds, actorUserId),
      getMyTicketMap(eventIds, actorUserId),
      getOrganizerVerificationMap(organizerIds),
      getCoworkerTicketCountMap({ eventIds, actorUserId }),
    ]);

  const scored = filtered.map((entry) => {
    const key = String(entry.event._id);
    const mapped = mapEventForResponse({
      event: entry.event,
      occurrence: entry.occurrence,
      stats: statsMap.get(key),
      ratings: ratingsMap.get(key),
      myTicket: myTicketMap.get(key),
      organizerBadge: organizerBadgeMap.get(toIdString(entry.event.organizerUserId)),
      coworkerTicketCount: coworkerTicketMap.get(key) || 0,
      now,
    });

    const daysUntil =
      (new Date(mapped.nextOccurrenceAt).getTime() - now.getTime()) / DAY_MS;
    const proximityBoost = Math.max(0, 24 - Math.max(0, daysUntil));
    const score =
      Number(mapped.soldTickets || 0) * 1.7 +
      Number(mapped.pendingTickets || 0) * 0.8 +
      Number(mapped.averageRating || 0) * 14 +
      Math.min(30, Number(mapped.ratingsCount || 0)) * 0.7 +
      proximityBoost;

    return {
      item: mapped,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, safeLimit).map((entry) => entry.item);
};

const buildOrganizerProfile = async ({ event, actorUserId, now }) => {
  const organizerId = toIdString(event.organizerUserId);

  if (!organizerId) {
    return null;
  }

  const organizerUser =
    typeof event.organizerUserId === "object"
      ? event.organizerUserId
      : await User.findById(organizerId).select("fullName email avatarUrl title");

  const [hostedEventsCount, attendeesRows, organizerEvents] = await Promise.all([
    Event.countDocuments({
      organizerUserId: organizerId,
    }),
    EventTicket.aggregate([
      {
        $match: {
          organizerUserId: event.organizerUserId?._id || event.organizerUserId,
          status: { $in: ["paid", "used"] },
        },
      },
      {
        $group: {
          _id: null,
          quantity: { $sum: "$quantity" },
        },
      },
    ]),
    Event.find({
      organizerUserId: organizerId,
      _id: { $ne: event._id },
      status: { $in: ["draft", "published", "cancelled"] },
    })
      .populate("organizerUserId", "fullName email avatarUrl title")
      .populate("workspaceId", "name slug")
      .sort({ startsAt: -1, createdAt: -1 })
      .limit(10),
  ]);

  const organizerEventIds = organizerEvents.map((item) => item._id);
  const [statsMap, ratingsMap, organizerBadgeMap] = await Promise.all([
    getEventTicketStatsMap(organizerEventIds),
    getEventRatingsSummaryMap(organizerEventIds, actorUserId),
    getOrganizerVerificationMap([organizerId]),
  ]);

  const mappedHostedEvents = organizerEvents.map((item) =>
    mapEventForResponse({
      event: item,
      occurrence:
        resolveOccurrenceWindow(item, now) || {
          startsAt: new Date(item.startsAt),
          endsAt: new Date(item.endsAt),
        },
      stats: statsMap.get(String(item._id)),
      ratings: ratingsMap.get(String(item._id)),
      myTicket: null,
      organizerBadge: organizerBadgeMap.get(organizerId),
      now,
    }),
  );

  const upcomingHostedEvents = mappedHostedEvents
    .filter((item) => new Date(item.nextOccurrenceEndsAt).getTime() >= now.getTime())
    .slice(0, 4);

  const previousHostedEvents = mappedHostedEvents
    .filter((item) => new Date(item.nextOccurrenceEndsAt).getTime() < now.getTime())
    .slice(0, 6);

  return {
    user: organizerUser,
    badge: organizerBadgeMap.get(organizerId) || null,
    hostedEventsCount,
    totalAttendees: Number(attendeesRows[0]?.quantity || 0),
    upcomingHostedEvents,
    previousHostedEvents,
  };
};

const getOrganizerProfileById = async ({
  organizerUserId,
  actorUserId,
}) => {
  const organizer = await User.findById(organizerUserId).select(
    "fullName email avatarUrl title bio",
  );

  if (!organizer) {
    throw new ApiError(404, "Organizer not found");
  }

  const referenceEvent = await Event.findOne({
    organizerUserId,
  })
    .sort({ startsAt: -1, createdAt: -1 })
    .populate("organizerUserId", "fullName email avatarUrl title bio")
    .populate("workspaceId", "name slug");

  if (referenceEvent) {
    return buildOrganizerProfile({
      event: referenceEvent,
      actorUserId,
      now: new Date(),
    });
  }

  const organizerBadgeMap = await getOrganizerVerificationMap([
    String(organizer._id),
  ]);

  return {
    user: organizer,
    badge: organizerBadgeMap.get(String(organizer._id)) || null,
    hostedEventsCount: 0,
    totalAttendees: 0,
    upcomingHostedEvents: [],
    previousHostedEvents: [],
  };
};

const getEventById = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId)
    .populate("organizerUserId", "fullName email avatarUrl title")
    .populate("workspaceId", "name slug");

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);

  const now = new Date();
  const occurrence = resolveOccurrenceWindow(event, now) || {
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
  };

  const [statsMap, ratingsMap, myTickets, ratingsPreview, organizerProfile, featuredEvents, organizerBadgeMap, coworkerTicketMap] =
    await Promise.all([
      getEventTicketStatsMap([event._id]),
      getEventRatingsSummaryMap([event._id], actorUserId),
      EventTicket.find({
        eventId,
        buyerUserId: actorUserId,
        status: { $in: ["pending", "paid", "used", "cancelled"] },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("usedByUserId", "fullName email avatarUrl title"),
      EventRating.find({ eventId: event._id })
        .populate("userId", "fullName avatarUrl title")
        .sort({ createdAt: -1 })
        .limit(8),
      buildOrganizerProfile({
        event,
        actorUserId,
        now,
      }),
      listFeaturedEvents({
        actorUserId,
        limit: 8,
        workspaceId: event.workspaceId
          ? String(event.workspaceId?._id || event.workspaceId)
          : undefined,
      }),
      getOrganizerVerificationMap([toIdString(event.organizerUserId)]),
      getCoworkerTicketCountMap({ eventIds: [event._id], actorUserId }),
    ]);

  const mappedEvent = mapEventForResponse({
    event,
    occurrence,
    stats: statsMap.get(String(event._id)),
    ratings: ratingsMap.get(String(event._id)),
    myTicket: myTickets[0] || null,
    organizerBadge: organizerBadgeMap.get(toIdString(event.organizerUserId)),
    coworkerTicketCount: coworkerTicketMap.get(String(event._id)) || 0,
    now,
  });

  return {
    event: mappedEvent,
    myTickets,
    organizerProfile,
    featuredEvents: featuredEvents
      .filter((item) => String(item._id) !== String(event._id))
      .slice(0, 6),
    ratings: {
      averageRating: mappedEvent.averageRating,
      ratingsCount: mappedEvent.ratingsCount,
      myRating: mappedEvent.myRating,
      items: ratingsPreview,
    },
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

  await ensureEventCanBeEditedBy(event, actorUserId);

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

  const hasTicketCategoriesUpdate = Array.isArray(payload.ticketCategories);
  const nextIsPaid =
    payload.isPaid !== undefined ? payload.isPaid : Boolean(event.isPaid);
  const hasPricingShapeChange =
    payload.isPaid !== undefined ||
    payload.ticketPriceNaira !== undefined ||
    hasTicketCategoriesUpdate;

  if (payload.isPaid === true && payload.ticketPriceNaira !== undefined && payload.ticketPriceNaira <= 0) {
    throw new ApiError(400, "Paid events require ticketPriceNaira greater than 0");
  }

  if (
    hasPricingShapeChange &&
    await EventTicket.exists({
      eventId: event._id,
      status: { $in: ["pending", "paid", "used"] },
    })
  ) {
    throw new ApiError(
      409,
      "Ticket pricing, paid/free mode, and categories lock after tickets are issued",
    );
  }

  if (
    event.ticketCategories?.length &&
    !hasTicketCategoriesUpdate &&
    payload.expectedTickets !== undefined
  ) {
    throw new ApiError(
      400,
      "Expected ticket count is controlled by ticket categories for this event",
    );
  }

  if (
    event.ticketCategories?.length &&
    !hasTicketCategoriesUpdate &&
    payload.ticketPriceNaira !== undefined
  ) {
    throw new ApiError(
      400,
      "Update ticket category prices instead of the base ticket price for this event",
    );
  }

  Object.assign(event, payload);

  if (hasTicketCategoriesUpdate) {
    const normalizedCategories = normalizeTicketCategories({
      categories: payload.ticketCategories,
      isPaid: nextIsPaid,
    });
    const categoryTotals = getTicketCategoryTotals(normalizedCategories);

    event.ticketCategories = normalizedCategories;
    event.expectedTickets =
      normalizedCategories.length > 0
        ? categoryTotals.expectedTickets
        : payload.expectedTickets !== undefined
          ? payload.expectedTickets
          : event.expectedTickets;

    if (normalizedCategories.length > 0) {
      event.ticketPriceNaira = nextIsPaid
        ? Math.max(0, Number(categoryTotals.baseTicketPriceNaira || 0))
        : 0;
    }
  }

  if (!event.isPaid) {
    event.ticketPriceNaira = 0;

    if (Array.isArray(event.ticketCategories) && event.ticketCategories.length) {
      event.ticketCategories = event.ticketCategories.map((category) => ({
        ...(typeof category.toObject === "function"
          ? category.toObject()
          : category),
        priceNaira: 0,
      }));
    }
  }

  if (payload.recurrence) {
    event.recurrence = normalizeRecurrence(
      payload.recurrence,
      payload.startsAt ? new Date(payload.startsAt) : new Date(event.startsAt),
    );
  }

  if (payload.resale) {
    event.resale = {
      ...normalizeEventResalePolicy(event),
      ...payload.resale,
    };
  }

  await event.save();

  return event;
};

const deleteEvent = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeEditedBy(event, actorUserId);

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

const countReservedTickets = async (eventId, ticketCategoryId = null) => {
  const pendingCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const rows = await EventTicket.aggregate([
    {
      $match: {
        eventId,
        ...(ticketCategoryId
          ? {
              ticketCategoryId: new mongoose.Types.ObjectId(
                String(ticketCategoryId),
              ),
            }
          : {}),
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
  const hasTicketCategories =
    Array.isArray(event.ticketCategories) && event.ticketCategories.length > 0;
  const requestedCategoryId = String(payload.ticketCategoryId || "").trim();
  const selectedCategory = hasTicketCategories
    ? event.ticketCategories.find(
        (category) => String(category._id) === requestedCategoryId,
      ) ||
      (event.ticketCategories.length === 1 ? event.ticketCategories[0] : null)
    : null;

  if (hasTicketCategories && !selectedCategory) {
    throw new ApiError(400, "Select a valid ticket category before checkout");
  }

  const reserved = await countReservedTickets(
    event._id,
    selectedCategory ? String(selectedCategory._id) : null,
  );

  if (selectedCategory) {
    if (reserved + quantity > Number(selectedCategory.quantity || 0)) {
      throw new ApiError(
        409,
        `The ${selectedCategory.name} category is sold out for that quantity`,
      );
    }
  } else if (reserved + quantity > Number(event.expectedTickets || 0)) {
    throw new ApiError(409, "Ticket capacity has been reached");
  }

  const dynamicPricing = getDynamicTicketPricing({
    event,
    occurrence,
    soldTickets: reserved,
    pendingTickets: 0,
    now: new Date(),
  });
  const unitPriceNaira = event.isPaid
    ? selectedCategory
      ? Number(selectedCategory.priceNaira || 0)
      : Number(dynamicPricing.currentTicketPriceNaira || event.ticketPriceNaira || 0)
    : 0;
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
        ticketCategoryId: selectedCategory?._id || null,
        ticketCategoryName: selectedCategory?.name || "",
        unitPriceNaira,
        totalPriceNaira,
        currency: "NGN",
        status: event.isPaid && !shouldBypassPaystack ? "pending" : "paid",
        paymentProvider: event.isPaid && !shouldBypassPaystack ? "paystack" : "none",
        paymentMetadata: {
          pricing: dynamicPricing.pricingInsight,
          basePriceNaira: Number(event.ticketPriceNaira || 0),
          appliedUnitPriceNaira: unitPriceNaira,
          ticketCategoryId: selectedCategory ? String(selectedCategory._id) : null,
          ticketCategoryName: selectedCategory?.name || null,
        },
        attendeeName: String(payload.attendeeName || buyer.fullName || "").trim(),
        attendeeEmail,
        ticketCode,
        barcodeValue: selectedCategory
          ? JSON.stringify({
              provider: "vera",
              ticketCode,
              eventId: String(event._id),
              ticketCategoryId: String(selectedCategory._id),
            })
          : barcodeValue,
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
      paymentAttemptId: null,
      kind: "ticket_purchase",
    };
  }

  const callbackUrl = String(payload.callbackUrl || env.paystackCallbackUrl || "").trim();
  const paystackAmountKobo = Math.round(totalPriceNaira * 100);
  let paymentAttempt;

  try {
    paymentAttempt = await createPaymentAttemptForCheckout({
      kind: "ticket_purchase",
      buyerUserId: actorUserId,
      eventId: event._id,
      ticketId: baseTicket._id,
      amountKobo: paystackAmountKobo,
      callbackUrl,
      email: attendeeEmail,
      referenceSuffix: String(baseTicket._id),
      metadata: {
        ticketId: String(baseTicket._id),
        eventId: String(event._id),
        buyerUserId: String(actorUserId),
        quantity,
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

  baseTicket.paymentReference = paymentAttempt.reference;
  baseTicket.paymentAuthorizationUrl = paymentAttempt.authorizationUrl;
  baseTicket.paymentAccessCode = paymentAttempt.accessCode;
  baseTicket.paymentMetadata = {
    ...(baseTicket.paymentMetadata || {}),
    initializePayload: paymentAttempt.paystackInitializePayload,
    paymentAttemptId: String(paymentAttempt._id),
  };
  await baseTicket.save();

  return {
    requiresPayment: true,
    ticket: baseTicket,
    payment: buildCheckoutPayment(paymentAttempt),
    paymentAttemptId: String(paymentAttempt._id),
    kind: "ticket_purchase",
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

  const paymentAttempt = await getPaymentAttemptForVerification({
    reference: paymentReference,
    ticketId: ticket._id,
    kind: "ticket_purchase",
  });

  if (paymentAttempt?.fulfillmentStatus === "done") {
    if (ticket.status !== "paid" && ticket.status !== "used") {
      const verifiedPayload =
        paymentAttempt.paystackVerifyPayload ||
        (await verifyPaystackTransaction(paymentReference));

      await finalizeTicketPurchasePayment({
        ticket,
        paymentAttempt,
        paymentReference,
        paymentData: verifiedPayload,
      });
    }

    return {
      ticket,
      paymentStatus: "success",
      alreadyVerified: true,
    };
  }

  const paymentData = await verifyPaystackTransaction(paymentReference);
  const paidStatus = String(paymentData.status || "").toLowerCase();

  if (paidStatus !== "success") {
    if (paymentAttempt) {
      paymentAttempt.status =
        paidStatus === "abandoned" ? "abandoned" : "failed";
      paymentAttempt.paystackVerifyPayload = paymentData;
      paymentAttempt.failureReason = "Payment has not been completed";
      await paymentAttempt.save();
    }

    throw new ApiError(402, "Payment has not been completed", {
      paymentStatus: paidStatus,
    });
  }

  const amountKobo = Number(paymentData.amount || 0);
  const expectedKobo = Math.round(Number(ticket.totalPriceNaira || 0) * 100);

  if (amountKobo < expectedKobo) {
    await markPaymentAttemptFulfillmentFailed({
      paymentAttempt,
      paymentData,
      reason: "Paid amount is below the expected ticket amount",
    });

    throw new ApiError(409, "Paid amount is below the expected ticket amount", {
      amountKobo,
      expectedKobo,
    });
  }

  await finalizeTicketPurchasePayment({
    ticket,
    paymentAttempt,
    paymentReference,
    paymentData,
  });

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

const listOrganizerTicketSales = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
  status = "all",
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;
  const query = {
    organizerUserId: actorUserId,
  };

  if (status !== "all") {
    query.status = status;
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
    const matchingEvents = await Event.find({
      organizerUserId: actorUserId,
      $or: [{ name: pattern }, { address: pattern }],
    })
      .select("_id")
      .limit(4000)
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
      .populate("buyerUserId", "fullName email avatarUrl title")
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
  let ticket = await populateResaleTicketQuery(EventTicket.findById(ticketId))
    .populate("acceptedBidId");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  ticket = await expireAcceptedResaleOffer({ ticket });

  const isBuyer = toIdString(ticket.buyerUserId) === String(actorUserId);
  const isOrganizer = toIdString(ticket.organizerUserId) === String(actorUserId);

  if (!isBuyer && !isOrganizer) {
    throw new ApiError(403, "You cannot access this ticket");
  }

  return ticket;
};

const listEventResaleMarketplace = async ({
  eventId,
  actorUserId,
  page = 1,
  limit = 20,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;

  const baseQuery = {
    eventId: event._id,
    status: "paid",
    $or: [
      { resaleStatus: "listed" },
      {
        resaleStatus: "offer-accepted",
        resaleBuyerUserId: actorUserId,
      },
    ],
  };

  const [rawItems, totalItems] = await Promise.all([
    populateResaleTicketQuery(
      EventTicket.find(baseQuery)
        .sort({ resaleListedAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    EventTicket.countDocuments(baseQuery),
  ]);

  const items = [];

  for (const ticket of rawItems) {
    const normalized = await expireAcceptedResaleOffer({ ticket });

    const reservedForActor =
      normalized?.resaleStatus === "offer-accepted" &&
      toIdString(normalized?.resaleBuyerUserId) === String(actorUserId);

    if (normalized?.resaleStatus !== "listed" && !reservedForActor) {
      continue;
    }

    const formatted = await formatResaleTicketForResponse(normalized, actorUserId);

    if (formatted) {
      items.push(formatted);
    }
  }

  return {
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const createTicketResale = async ({ ticketId, actorUserId, payload }) => {
  let ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  const { event, policy } = await ensureTicketEligibleForResale({
    ticket,
    actorUserId,
  });

  ticket = await expireAcceptedResaleOffer({ ticket });

  if (ticket.resaleStatus === "offer-accepted") {
    throw new ApiError(409, "This ticket already has an accepted buyer");
  }

  const priceNaira = Math.max(1, Math.round(Number(payload.priceNaira || 0)));
  const requestedQuantity = Math.max(1, Number(payload.quantity || 1));

  if (requestedQuantity > Math.max(1, Number(ticket.quantity || 1))) {
    throw new ApiError(400, "You cannot list more tickets than you currently hold");
  }

  const resaleQuantity = requestedQuantity;
  const baseCostNaira = Math.max(
    1,
    Math.round(Number(ticket.unitPriceNaira || 0) * resaleQuantity),
  );
  const maxAllowedPrice = Math.max(
    1,
    Math.round(
      baseCostNaira * (1 + policy.maxMarkupPercent / 100),
    ),
  );

  if (priceNaira > maxAllowedPrice) {
    throw new ApiError(
      400,
      `This event caps resale at ₦${maxAllowedPrice.toLocaleString()}`,
    );
  }

  const allowBids =
    payload.allowBids === undefined ? policy.allowBids : Boolean(payload.allowBids);
  const now = new Date();

  await TicketResaleBid.updateMany(
    {
      ticketId: ticket._id,
      status: "open",
    },
    {
      $set: {
        status: "rejected",
        respondedAt: now,
      },
    },
  );

  const updated = await populateResaleTicketQuery(
    EventTicket.findByIdAndUpdate(
      ticket._id,
      {
        $set: {
        resaleStatus: "listed",
        resalePriceNaira: priceNaira,
        resaleQuantity,
        resaleAllowBids: allowBids,
        resaleListedAt: now,
        acceptedBidId: null,
          acceptedBidExpiresAt: null,
          resaleBuyerUserId: null,
        },
      },
      { new: true },
    ),
  );

  return formatResaleTicketForResponse(updated, actorUserId);
};

const cancelTicketResale = async ({ ticketId, actorUserId }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  const now = new Date();

  await TicketResaleBid.updateMany(
    {
      ticketId: ticket._id,
      status: { $in: ["open", "accepted"] },
    },
    {
      $set: {
        status: "rejected",
        respondedAt: now,
      },
    },
  );

  const updated = await clearTicketResaleFields(ticket._id);
  return updated;
};

const listTicketResaleBids = async ({
  ticketId,
  actorUserId,
  page = 1,
  limit = 20,
}) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  await expireAcceptedResaleOffer({ ticket });

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;

  const query = {
    ticketId: ticket._id,
  };

  const [items, totalItems] = await Promise.all([
    TicketResaleBid.find(query)
      .populate("bidderUserId", "fullName email avatarUrl title")
      .sort({
        status: 1,
        amountNaira: -1,
        createdAt: 1,
      })
      .skip(skip)
      .limit(limitNumber),
    TicketResaleBid.countDocuments(query),
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

const createTicketResaleBid = async ({ ticketId, actorUserId, payload }) => {
  let ticket = await populateResaleTicketQuery(EventTicket.findById(ticketId));

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  ticket = await expireAcceptedResaleOffer({ ticket });

  if (ticket.resaleStatus !== "listed") {
    throw new ApiError(400, "This ticket is not open for resale");
  }

  if (!ticket.resaleAllowBids) {
    throw new ApiError(400, "Bidding is disabled for this ticket");
  }

  if (ticket.status !== "paid" || ticket.usedAt || ticket.status === "used") {
    throw new ApiError(400, "This ticket can no longer be resold");
  }

  if (toIdString(ticket.buyerUserId) === String(actorUserId)) {
    throw new ApiError(400, "You already own this ticket");
  }

  const amountNaira = Math.max(1, Math.round(Number(payload.amountNaira || 0)));
  const maxBid = Math.max(1, Math.round(Number(ticket.resalePriceNaira || 0)));

  if (amountNaira > maxBid) {
    throw new ApiError(
      400,
      `Bids cannot exceed the asking price of ₦${maxBid.toLocaleString()}`,
    );
  }

  const now = new Date();
  const existing = await TicketResaleBid.findOne({
    ticketId: ticket._id,
    bidderUserId: actorUserId,
    status: "open",
  });

  let bid = null;

  if (existing) {
    existing.amountNaira = amountNaira;
    existing.respondedAt = null;
    await existing.save();
    bid = existing;
  } else {
    bid = await TicketResaleBid.create({
      ticketId: ticket._id,
      eventId: ticket.eventId?._id || ticket.eventId,
      sellerUserId: ticket.buyerUserId?._id || ticket.buyerUserId,
      bidderUserId: actorUserId,
      amountNaira,
      status: "open",
    });
  }

  await bid.populate("bidderUserId", "fullName email avatarUrl title");

  const sellerUserId = toIdString(ticket.buyerUserId);

  if (sellerUserId) {
    void createNotification({
      userId: sellerUserId,
      type: "ticket.resale.bid_placed",
      title: "New bid on your ticket",
      message: `${bid.bidderUserId?.fullName || "A buyer"} offered ₦${amountNaira.toLocaleString()}.`,
      data: {
        target: "ticket-resale",
        ticketId: String(ticket._id),
        eventId: toIdString(ticket.eventId),
      },
      push: true,
    }).catch(() => null);
  }

  return bid;
};

const acceptTicketResaleBid = async ({ ticketId, bidId, actorUserId }) => {
  let ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  const { event, policy } = await ensureTicketEligibleForResale({
    ticket,
    actorUserId,
  });

  ticket = await expireAcceptedResaleOffer({ ticket });

  if (ticket.resaleStatus !== "listed") {
    throw new ApiError(400, "This ticket is not currently accepting bids");
  }

  const bid = await TicketResaleBid.findOne({
    _id: bidId,
    ticketId: ticket._id,
    status: "open",
  }).populate("bidderUserId", "fullName email avatarUrl title");

  if (!bid) {
    throw new ApiError(404, "Bid not found");
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + policy.bidWindowHours * 60 * 60 * 1000,
  );

  await TicketResaleBid.updateOne(
    { _id: bid._id },
    {
      $set: {
        status: "accepted",
        respondedAt: now,
        expiresAt,
      },
    },
  );

  const rejectedBids = await TicketResaleBid.find({
    ticketId: ticket._id,
    status: "open",
    _id: { $ne: bid._id },
  })
    .select("_id bidderUserId")
    .lean();

  if (rejectedBids.length) {
    await TicketResaleBid.updateMany(
      {
        _id: { $in: rejectedBids.map((item) => item._id) },
      },
      {
        $set: {
          status: "rejected",
          respondedAt: now,
        },
      },
    );
  }

  await EventTicket.updateOne(
    { _id: ticket._id },
    {
      $set: {
        resaleStatus: "offer-accepted",
        acceptedBidId: bid._id,
        acceptedBidExpiresAt: expiresAt,
        resaleBuyerUserId: bid.bidderUserId?._id || bid.bidderUserId,
      },
    },
  );

  void createNotification({
    userId: bid.bidderUserId?._id || bid.bidderUserId,
    type: "ticket.resale.bid_accepted",
    title: "Your bid was accepted",
    message: `Complete payment for ${event.name} within ${policy.bidWindowHours} hours.`,
    data: {
      target: "ticket-resale",
      ticketId: String(ticket._id),
      eventId: String(event._id),
      bidId: String(bid._id),
    },
    push: true,
  }).catch(() => null);

  for (const rejected of rejectedBids) {
    void createNotification({
      userId: rejected.bidderUserId,
      type: "ticket.resale.bid_rejected",
      title: "Bid not accepted",
      message: "The seller chose another buyer for this ticket.",
      data: {
        target: "ticket-resale",
        ticketId: String(ticket._id),
        eventId: String(event._id),
      },
      push: true,
    }).catch(() => null);
  }

  return TicketResaleBid.findById(bid._id).populate(
    "bidderUserId",
    "fullName email avatarUrl title",
  );
};

const rejectTicketResaleBid = async ({ ticketId, bidId, actorUserId }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });

  const bid = await TicketResaleBid.findOne({
    _id: bidId,
    ticketId: ticket._id,
    status: "open",
  }).populate("bidderUserId", "fullName email avatarUrl title");

  if (!bid) {
    throw new ApiError(404, "Bid not found");
  }

  await TicketResaleBid.updateOne(
    { _id: bid._id },
    {
      $set: {
        status: "rejected",
        respondedAt: new Date(),
      },
    },
  );

  void createNotification({
    userId: bid.bidderUserId?._id || bid.bidderUserId,
    type: "ticket.resale.bid_rejected",
    title: "Bid rejected",
    message: "The seller declined your offer on this ticket.",
    data: {
      target: "ticket-resale",
      ticketId: String(ticket._id),
      eventId: toIdString(ticket.eventId),
      bidId: String(bid._id),
    },
    push: true,
  }).catch(() => null);

  return TicketResaleBid.findById(bid._id).populate(
    "bidderUserId",
    "fullName email avatarUrl title",
  );
};

const purchaseResaleTicket = async ({
  ticketId,
  actorUserId,
  paymentReference = "",
  paymentAttemptId = null,
  paymentData = null,
}) => {
  let ticket = await populateResaleTicketQuery(EventTicket.findById(ticketId));

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  ticket = await expireAcceptedResaleOffer({ ticket });

  if (ticket.resaleStatus !== "listed" && ticket.resaleStatus !== "offer-accepted") {
    throw new ApiError(400, "This ticket is not available to buy");
  }

  if (ticket.status !== "paid" || ticket.usedAt || ticket.status === "used") {
    throw new ApiError(400, "This ticket can no longer be transferred");
  }

  const sellerUserId = toIdString(ticket.buyerUserId);
  const normalizedPaymentReference = String(paymentReference || "").trim();
  const isPaymentBackedTransfer = Boolean(
    normalizedPaymentReference || paymentAttemptId || paymentData,
  );

  if (sellerUserId === String(actorUserId)) {
    throw new ApiError(400, "You already own this ticket");
  }

  const buyer = await User.findById(actorUserId).select("fullName email");

  if (!buyer) {
    throw new ApiError(404, "Buyer account not found");
  }

  let saleAmountNaira = Math.max(1, Math.round(Number(ticket.resalePriceNaira || 0)));
  let acceptedBid = null;
  const listedQuantity = Math.min(
    Math.max(1, Number(ticket.resaleQuantity || 1)),
    Math.max(1, Number(ticket.quantity || 1)),
  );

  if (ticket.resaleStatus === "offer-accepted") {
    if (toIdString(ticket.resaleBuyerUserId) !== String(actorUserId)) {
      throw new ApiError(403, "This offer is reserved for another buyer");
    }

    if (ticket.acceptedBidId) {
      acceptedBid = await TicketResaleBid.findById(ticket.acceptedBidId);

      if (!acceptedBid || acceptedBid.status !== "accepted") {
        throw new ApiError(400, "This accepted bid is no longer valid");
      }
    }

    if (
      ((acceptedBid?.expiresAt &&
        new Date(acceptedBid.expiresAt).getTime() <= Date.now()) ||
        (ticket.acceptedBidExpiresAt &&
          new Date(ticket.acceptedBidExpiresAt).getTime() <= Date.now()))
    ) {
      await expireAcceptedResaleOffer({ ticket, now: new Date() });
      throw new ApiError(400, "The payment window expired for this offer");
    }

    if (acceptedBid) {
      saleAmountNaira = Math.max(
        1,
        Math.round(Number(acceptedBid.amountNaira || saleAmountNaira)),
      );
    }
  } else if (ticket.resaleAllowBids) {
    throw new ApiError(400, "This listing requires a bid before payment");
  }

  const now = new Date();
  let transferredTicketId = ticket._id;

  if (listedQuantity < Number(ticket.quantity || 1)) {
    const transferredTicketCode = await buildTicketCode();
    const transferredUnitPrice = Math.max(
      0,
      Math.round(saleAmountNaira / listedQuantity),
    );

    const createdTicket = await EventTicket.create({
      eventId: ticket.eventId?._id || ticket.eventId,
      workspaceId: ticket.workspaceId || null,
      organizerUserId: ticket.organizerUserId?._id || ticket.organizerUserId,
      buyerUserId: buyer._id,
      quantity: listedQuantity,
      ticketCategoryId: ticket.ticketCategoryId || null,
      ticketCategoryName: ticket.ticketCategoryName || "",
      unitPriceNaira: transferredUnitPrice,
      totalPriceNaira: saleAmountNaira,
      currency: ticket.currency || "NGN",
      status: "paid",
      paymentProvider: isPaymentBackedTransfer ? "paystack" : "none",
      paymentReference: normalizedPaymentReference || null,
      paymentMetadata: {
        ...(ticket.paymentMetadata || {}),
        resale: {
          previousBuyerUserId: sellerUserId,
          soldToUserId: String(buyer._id),
          soldAt: now,
          amountNaira: saleAmountNaira,
          sourceTicketId: String(ticket._id),
        },
        paymentAttemptId: paymentAttemptId ? String(paymentAttemptId) : undefined,
        verifyPayload: paymentData || undefined,
      },
      attendeeName: String(buyer.fullName || "").trim(),
      attendeeEmail: String(buyer.email || "").trim().toLowerCase(),
      ticketCode: transferredTicketCode,
      barcodeValue: ticket.ticketCategoryId
        ? JSON.stringify({
            provider: "vera",
            ticketCode: transferredTicketCode,
            eventId: String(ticket.eventId?._id || ticket.eventId),
            ticketCategoryId: String(ticket.ticketCategoryId),
          })
        : transferredTicketCode,
      paidAt: now,
      verifiedAt: now,
      lastTransferredAt: now,
    });

    transferredTicketId = createdTicket._id;

    await EventTicket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          quantity: Math.max(1, Number(ticket.quantity || 1) - listedQuantity),
          totalPriceNaira:
            Math.max(1, Number(ticket.quantity || 1) - listedQuantity) *
            Math.max(0, Number(ticket.unitPriceNaira || 0)),
          paymentMetadata: {
            ...(ticket.paymentMetadata || {}),
            resale: {
              previousBuyerUserId: sellerUserId,
              soldToUserId: String(buyer._id),
              soldAt: now,
              amountNaira: saleAmountNaira,
              splitQuantity: listedQuantity,
              transferredTicketId: String(createdTicket._id),
            },
          },
          lastTransferredAt: now,
          resaleStatus: "none",
          resalePriceNaira: null,
          resaleQuantity: null,
          resaleAllowBids: false,
          resaleListedAt: null,
          acceptedBidId: null,
          acceptedBidExpiresAt: null,
          resaleBuyerUserId: null,
        },
      },
    );
  } else {
    await EventTicket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          buyerUserId: buyer._id,
          attendeeName: String(buyer.fullName || "").trim(),
          attendeeEmail: String(buyer.email || "").trim().toLowerCase(),
          unitPriceNaira: Math.max(0, Math.round(saleAmountNaira / listedQuantity)),
          totalPriceNaira: saleAmountNaira,
          paymentProvider: isPaymentBackedTransfer ? "paystack" : "none",
          paymentReference: normalizedPaymentReference || null,
          paymentAuthorizationUrl: "",
          paymentAccessCode: "",
          paidAt: now,
          verifiedAt: now,
          paymentMetadata: {
            ...(ticket.paymentMetadata || {}),
            resale: {
              previousBuyerUserId: sellerUserId,
              soldToUserId: String(buyer._id),
              soldAt: now,
              amountNaira: saleAmountNaira,
            },
            paymentAttemptId: paymentAttemptId ? String(paymentAttemptId) : undefined,
            verifyPayload: paymentData || undefined,
          },
          lastTransferredAt: now,
          resaleStatus: "none",
          resalePriceNaira: null,
          resaleQuantity: null,
          resaleAllowBids: false,
          resaleListedAt: null,
          acceptedBidId: null,
          acceptedBidExpiresAt: null,
          resaleBuyerUserId: null,
        },
      },
    );
  }

  await TicketResaleBid.updateMany(
    {
      ticketId: ticket._id,
      status: "open",
    },
    {
      $set: {
        status: "rejected",
        respondedAt: now,
      },
    },
  );

  if (acceptedBid) {
    await TicketResaleBid.updateOne(
      { _id: acceptedBid._id },
      {
        $set: {
          status: "paid",
          respondedAt: now,
          paidAt: now,
        },
      },
    );
  }

  const updated = await populateResaleTicketQuery(
    EventTicket.findById(transferredTicketId),
  );

  if (sellerUserId) {
    void createNotification({
      userId: sellerUserId,
      type: "ticket.resale.completed",
      title: "Ticket resold",
      message: `Your ticket was transferred for ₦${saleAmountNaira.toLocaleString()}.`,
      data: {
        target: "ticket-resale",
        ticketId: String(ticket._id),
        eventId: toIdString(ticket.eventId),
      },
      push: true,
    }).catch(() => null);
  }

  void createNotification({
    userId: String(buyer._id),
    type: "ticket.resale.purchased",
    title: "Resale ticket confirmed",
    message: "Your ticket transfer is complete and ready to use.",
    data: {
        target: "ticket-details",
        ticketId: String(transferredTicketId),
        eventId: toIdString(ticket.eventId),
      },
    push: true,
  }).catch(() => null);

  return updated;
};

const initializeResalePurchase = async ({
  ticketId,
  actorUserId,
  payload,
}) => {
  let ticket = await populateResaleTicketQuery(EventTicket.findById(ticketId));

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  ticket = await expireAcceptedResaleOffer({ ticket });

  if (ticket.resaleStatus !== "listed" && ticket.resaleStatus !== "offer-accepted") {
    throw new ApiError(400, "This ticket is not available to buy");
  }

  if (ticket.status !== "paid" || ticket.usedAt || ticket.status === "used") {
    throw new ApiError(400, "This ticket can no longer be transferred");
  }

  const sellerUserId = toIdString(ticket.buyerUserId);

  if (sellerUserId === String(actorUserId)) {
    throw new ApiError(400, "You already own this ticket");
  }

  const buyer = await User.findById(actorUserId).select("fullName email");

  if (!buyer) {
    throw new ApiError(404, "Buyer account not found");
  }

  const event =
    ticket.eventId && typeof ticket.eventId === "object"
      ? ticket.eventId
      : await Event.findById(ticket.eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const shouldBypassPaystack = !env.paystackSecretKey && env.paystackDevBypass;

  if (!env.paystackSecretKey && !shouldBypassPaystack) {
    throw new ApiError(
      503,
      "Paid resale checkout is not configured yet. Set PAYSTACK_SECRET_KEY.",
    );
  }

  let saleAmountNaira = Math.max(1, Math.round(Number(ticket.resalePriceNaira || 0)));
  let acceptedBid = null;
  let reservedInThisCall = false;
  const listedQuantity = Math.min(
    Math.max(1, Number(ticket.resaleQuantity || 1)),
    Math.max(1, Number(ticket.quantity || 1)),
  );

  if (ticket.resaleStatus === "offer-accepted") {
    if (toIdString(ticket.resaleBuyerUserId) !== String(actorUserId)) {
      throw new ApiError(403, "This offer is reserved for another buyer");
    }

    if (ticket.acceptedBidId) {
      acceptedBid = await TicketResaleBid.findById(ticket.acceptedBidId);

      if (!acceptedBid || acceptedBid.status !== "accepted") {
        throw new ApiError(400, "This accepted bid is no longer valid");
      }
    }

    if (
      (acceptedBid?.expiresAt &&
        new Date(acceptedBid.expiresAt).getTime() <= Date.now()) ||
      (ticket.acceptedBidExpiresAt &&
        new Date(ticket.acceptedBidExpiresAt).getTime() <= Date.now())
    ) {
      await expireAcceptedResaleOffer({ ticket, now: new Date() });
      throw new ApiError(400, "The payment window expired for this offer");
    }

    if (acceptedBid) {
      saleAmountNaira = Math.max(
        1,
        Math.round(Number(acceptedBid.amountNaira || saleAmountNaira)),
      );
    }
  } else {
    if (ticket.resaleAllowBids) {
      throw new ApiError(400, "This listing requires a bid before payment");
    }

    const resalePolicy = normalizeEventResalePolicy(event);
    const acceptedBidExpiresAt = new Date(
      Date.now() + resalePolicy.bidWindowHours * 60 * 60 * 1000,
    );

    await EventTicket.updateOne(
      {
        _id: ticket._id,
        resaleStatus: "listed",
      },
      {
        $set: {
          resaleStatus: "offer-accepted",
          acceptedBidId: null,
          acceptedBidExpiresAt,
          resaleBuyerUserId: actorUserId,
        },
      },
    );

    reservedInThisCall = true;
    ticket = await populateResaleTicketQuery(EventTicket.findById(ticket._id));
  }

  if (shouldBypassPaystack) {
    const transferredTicket = await purchaseResaleTicket({
      ticketId: String(ticket._id),
      actorUserId,
      paymentReference: generatePaystackReference(
        "ticket_resale_purchase",
        String(ticket._id),
      ),
      paymentData: {
        status: "success",
        amount: Math.round(saleAmountNaira * 100),
        currency: "NGN",
      },
    });

    return {
      requiresPayment: false,
      ticket: transferredTicket,
      payment: null,
      paymentAttemptId: null,
      kind: "ticket_resale_purchase",
    };
  }

  try {
    const paymentAttempt = await createPaymentAttemptForCheckout({
      kind: "ticket_resale_purchase",
      buyerUserId: actorUserId,
      eventId: event._id,
      resaleSourceTicketId: ticket._id,
      acceptedBidId: acceptedBid?._id || ticket.acceptedBidId || null,
      amountKobo: Math.round(saleAmountNaira * 100),
      callbackUrl: String(payload?.callbackUrl || env.paystackCallbackUrl || "").trim(),
      email: String(buyer.email || "").trim().toLowerCase(),
      referenceSuffix: String(ticket._id),
      metadata: {
        resaleSourceTicketId: String(ticket._id),
        eventId: String(event._id),
        buyerUserId: String(actorUserId),
        acceptedBidId: acceptedBid ? String(acceptedBid._id) : null,
        listedQuantity,
      },
    });

    return {
      requiresPayment: true,
      ticket,
      payment: buildCheckoutPayment(paymentAttempt),
      paymentAttemptId: String(paymentAttempt._id),
      kind: "ticket_resale_purchase",
    };
  } catch (error) {
    if (reservedInThisCall) {
      await EventTicket.updateOne(
        { _id: ticket._id },
        {
          $set: {
            resaleStatus: "listed",
            acceptedBidId: null,
            acceptedBidExpiresAt: null,
            resaleBuyerUserId: null,
          },
        },
      );
    }

    throw error;
  }
};

const verifyResalePurchase = async ({
  ticketId,
  actorUserId,
  reference,
}) => {
  const paymentAttempt = await getPaymentAttemptForVerification({
    reference,
    ticketId,
    kind: "ticket_resale_purchase",
  });

  if (!paymentAttempt) {
    throw new ApiError(404, "Could not find a pending resale payment");
  }

  if (toIdString(paymentAttempt.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only verify your own resale payment");
  }

  if (paymentAttempt.fulfillmentStatus === "done") {
    const fulfilledTicket = await populateResaleTicketQuery(
      EventTicket.findById(
        paymentAttempt.fulfillmentTicketId ||
          paymentAttempt.resaleSourceTicketId ||
          ticketId,
      ),
    );

    if (!fulfilledTicket) {
      throw new ApiError(404, "Ticket not found");
    }

    return {
      ticket: fulfilledTicket,
      paymentStatus: "success",
      alreadyVerified: true,
    };
  }

  const paymentReference = String(reference || paymentAttempt.reference || "").trim();

  if (!paymentReference) {
    throw new ApiError(400, "Payment reference is required for verification");
  }

  const paymentData = await verifyPaystackTransaction(paymentReference);
  const paidStatus = String(paymentData.status || "").toLowerCase();

  if (paidStatus !== "success") {
    paymentAttempt.status = paidStatus === "abandoned" ? "abandoned" : "failed";
    paymentAttempt.paystackVerifyPayload = paymentData;
    paymentAttempt.failureReason = "Payment has not been completed";
    await paymentAttempt.save();

    throw new ApiError(402, "Payment has not been completed", {
      paymentStatus: paidStatus,
    });
  }

  const amountKobo = Number(paymentData.amount || 0);
  const expectedKobo = Math.round(Number(paymentAttempt.amountKobo || 0));

  if (amountKobo < expectedKobo) {
    await markPaymentAttemptFulfillmentFailed({
      paymentAttempt,
      paymentData,
      reason: "Paid amount is below the expected resale amount",
    });

    throw new ApiError(409, "Paid amount is below the expected resale amount", {
      amountKobo,
      expectedKobo,
    });
  }

  let transferredTicket;

  try {
    transferredTicket = await purchaseResaleTicket({
      ticketId: String(
        paymentAttempt.resaleSourceTicketId || paymentAttempt.ticketId || ticketId,
      ),
      actorUserId,
      paymentReference,
      paymentAttemptId: paymentAttempt._id,
      paymentData,
    });
  } catch (error) {
    await markPaymentAttemptFulfillmentFailed({
      paymentAttempt,
      paymentData,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  await markPaymentAttemptVerified({
    paymentAttempt,
    paymentData,
    fulfillmentTicketId: transferredTicket?._id,
  });

  return {
    ticket: transferredTicket,
    paymentStatus: paidStatus,
    alreadyVerified: false,
  };
};

const processPaystackWebhookEvent = async (payload) => {
  const eventName = String(payload?.event || "").trim().toLowerCase();

  if (eventName !== "charge.success") {
    return {
      ignored: true,
      event: eventName || "unknown",
    };
  }

  const paymentData =
    payload?.data && typeof payload.data === "object" ? payload.data : null;
  const paymentReference = String(paymentData?.reference || "").trim();

  if (!paymentReference) {
    return {
      ignored: true,
      event: eventName,
      reason: "missing_reference",
    };
  }

  const paymentAttempt = await PaymentAttempt.findOne({
    reference: paymentReference,
  }).sort({ createdAt: -1 });

  if (!paymentAttempt) {
    const legacyTicket = await EventTicket.findOne({
      paymentReference,
      paymentProvider: "paystack",
    });

    if (!legacyTicket) {
      return {
        ignored: true,
        event: eventName,
        reason: "unknown_reference",
        reference: paymentReference,
      };
    }

    if (legacyTicket.status !== "paid" && legacyTicket.status !== "used") {
      await finalizeTicketPurchasePayment({
        ticket: legacyTicket,
        paymentReference,
        paymentData,
      });
    }

    return {
      processed: true,
      event: eventName,
      kind: "legacy_ticket_purchase",
      reference: paymentReference,
      ticketId: String(legacyTicket._id),
    };
  }

  if (paymentAttempt.fulfillmentStatus === "done") {
    return {
      processed: true,
      event: eventName,
      reference: paymentReference,
      paymentAttemptId: String(paymentAttempt._id),
      alreadyFulfilled: true,
    };
  }

  const amountKobo = Number(paymentData?.amount || 0);
  const expectedKobo = Math.round(Number(paymentAttempt.amountKobo || 0));
  const receivedCurrency = String(
    paymentData?.currency || paymentAttempt.currency || "NGN",
  ).toUpperCase();
  const expectedCurrency = String(paymentAttempt.currency || "NGN").toUpperCase();

  if (receivedCurrency !== expectedCurrency || amountKobo < expectedKobo) {
    await markPaymentAttemptFulfillmentFailed({
      paymentAttempt,
      paymentData,
      reason: "Webhook amount or currency does not match the expected charge",
    });

    return {
      processed: false,
      event: eventName,
      reference: paymentReference,
      reason: "amount_or_currency_mismatch",
    };
  }

  try {
    if (paymentAttempt.kind === "ticket_purchase") {
      let ticket = paymentAttempt.ticketId
        ? await EventTicket.findById(paymentAttempt.ticketId)
        : null;

      if (!ticket) {
        ticket = await EventTicket.findOne({
          paymentReference,
          paymentProvider: "paystack",
        });
      }

      if (!ticket) {
        return {
          ignored: true,
          event: eventName,
          reference: paymentReference,
          reason: "ticket_not_found",
        };
      }

      await finalizeTicketPurchasePayment({
        ticket,
        paymentAttempt,
        paymentReference,
        paymentData,
      });

      return {
        processed: true,
        event: eventName,
        kind: "ticket_purchase",
        reference: paymentReference,
        paymentAttemptId: String(paymentAttempt._id),
        ticketId: String(ticket._id),
      };
    }

    if (paymentAttempt.kind === "ticket_resale_purchase") {
      const transferredTicket = await purchaseResaleTicket({
        ticketId: String(
          paymentAttempt.resaleSourceTicketId || paymentAttempt.ticketId || "",
        ),
        actorUserId: String(paymentAttempt.buyerUserId || ""),
        paymentReference,
        paymentAttemptId: paymentAttempt._id,
        paymentData,
      });

      await markPaymentAttemptVerified({
        paymentAttempt,
        paymentData,
        fulfillmentTicketId: transferredTicket?._id,
      });

      return {
        processed: true,
        event: eventName,
        kind: "ticket_resale_purchase",
        reference: paymentReference,
        paymentAttemptId: String(paymentAttempt._id),
        ticketId: String(transferredTicket?._id || ""),
      };
    }

    return {
      ignored: true,
      event: eventName,
      reference: paymentReference,
      reason: "unsupported_payment_kind",
    };
  } catch (error) {
    await markPaymentAttemptFulfillmentFailed({
      paymentAttempt,
      paymentData,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const listTicketTodos = async ({ ticketId, actorUserId }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });

  const items = await TicketTodo.find({
    ticketId: ticket._id,
    userId: actorUserId,
  }).sort({ isCompleted: 1, dueAt: 1, createdAt: 1 });

  return items;
};

const createTicketTodo = async ({ ticketId, actorUserId, payload }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  const event =
    ticket.eventId && typeof ticket.eventId === "object"
      ? ticket.eventId
      : await Event.findById(ticket.eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const dueAt = new Date(payload.dueAt);
  const remindAt = payload.remindAt ? new Date(payload.remindAt) : dueAt;

  const todo = await TicketTodo.create({
    ticketId: ticket._id,
    eventId: event._id,
    userId: actorUserId,
    title: String(payload.title || "").trim(),
    notes: String(payload.notes || "").trim(),
    dueAt,
    remindAt,
  });

  return todo;
};

const updateTicketTodo = async ({ ticketId, todoId, actorUserId, payload }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });
  const existing = await TicketTodo.findOne({
    _id: todoId,
    ticketId: ticket._id,
    userId: actorUserId,
  });

  if (!existing) {
    throw new ApiError(404, "Todo not found");
  }

  const nextDueAt = payload.dueAt ? new Date(payload.dueAt) : existing.dueAt;
  const nextRemindAt =
    payload.remindAt === null
      ? null
      : payload.remindAt
        ? new Date(payload.remindAt)
        : existing.remindAt;

  if (
    nextRemindAt &&
    nextDueAt &&
    new Date(nextRemindAt).getTime() > new Date(nextDueAt).getTime()
  ) {
    throw new ApiError(400, "Reminder cannot be after the due date");
  }

  existing.title =
    payload.title !== undefined ? String(payload.title || "").trim() : existing.title;
  existing.notes =
    payload.notes !== undefined ? String(payload.notes || "").trim() : existing.notes;
  existing.dueAt = nextDueAt;
  existing.remindAt = nextRemindAt;

  if (payload.isCompleted !== undefined) {
    const isCompleted = Boolean(payload.isCompleted);
    existing.isCompleted = isCompleted;
    existing.completedAt = isCompleted ? new Date() : null;
    existing.notifiedAt = isCompleted ? existing.notifiedAt : null;
  }

  await existing.save();
  return existing;
};

const deleteTicketTodo = async ({ ticketId, todoId, actorUserId }) => {
  const ticket = await ensureOwnedTicket({ ticketId, actorUserId });

  const result = await TicketTodo.deleteOne({
    _id: todoId,
    ticketId: ticket._id,
    userId: actorUserId,
  });

  if (!result.deletedCount) {
    throw new ApiError(404, "Todo not found");
  }

  return {
    deleted: true,
    todoId: String(todoId),
  };
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

const listEventRatings = async ({
  eventId,
  actorUserId,
  page = 1,
  limit = 20,
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const event = await Event.findById(eventId)
    .populate("organizerUserId", "fullName email avatarUrl title");

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);

  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems, summaryRows, myRating] = await Promise.all([
    EventRating.find({ eventId })
      .populate("userId", "fullName avatarUrl title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    EventRating.countDocuments({ eventId }),
    EventRating.aggregate([
      {
        $match: {
          eventId: event._id,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          ratingsCount: { $sum: 1 },
        },
      },
    ]),
    EventRating.findOne({
      eventId,
      userId: actorUserId,
    }).select("rating review updatedAt"),
  ]);

  const summary = summaryRows[0] || {
    averageRating: 0,
    ratingsCount: 0,
  };

  return {
    items,
    averageRating: Number(summary.averageRating || 0),
    ratingsCount: Number(summary.ratingsCount || 0),
    myRating: myRating
      ? {
          rating: Number(myRating.rating || 0),
          review: myRating.review || "",
          updatedAt: myRating.updatedAt,
        }
      : null,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const rateEvent = async ({
  eventId,
  actorUserId,
  payload,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);

  const eligibleTicket = await EventTicket.exists({
    eventId: event._id,
    buyerUserId: actorUserId,
    status: { $in: ["paid", "used"] },
  });

  if (!eligibleTicket) {
    throw new ApiError(
      403,
      "You can only rate an event after securing an active ticket",
    );
  }

  const ratingValue = Number(payload.rating || 0);
  const review = String(payload.review || "").trim();

  const rating = await EventRating.findOneAndUpdate(
    {
      eventId: event._id,
      userId: actorUserId,
    },
    {
      $set: {
        rating: ratingValue,
        review,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).populate("userId", "fullName avatarUrl title");

  return rating;
};

const normalizeReminderOffsets = (offsets) => {
  if (!Array.isArray(offsets)) {
    return DEFAULT_REMINDER_OFFSETS;
  }

  const normalized = [...new Set(
    offsets
      .map((value) => Number(value))
      .filter(
        (value) =>
          Number.isInteger(value) && value >= 5 && value <= 14 * 24 * 60,
      ),
  )].sort((a, b) => b - a);

  return normalized.length ? normalized : DEFAULT_REMINDER_OFFSETS;
};

const getEventReminder = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const existing = await EventReminderPreference.findOne({
    eventId: event._id,
    userId: actorUserId,
  });

  if (!existing) {
    return {
      enabled: true,
      offsetsMinutes: DEFAULT_REMINDER_OFFSETS,
      isDefault: true,
    };
  }

  return {
    enabled: existing.enabled !== false,
    offsetsMinutes: normalizeReminderOffsets(existing.offsetsMinutes),
    isDefault: false,
    updatedAt: existing.updatedAt,
  };
};

const upsertEventReminder = async ({ eventId, actorUserId, payload }) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const enabled =
    payload.enabled === undefined ? true : Boolean(payload.enabled);
  const offsetsMinutes = normalizeReminderOffsets(payload.offsetsMinutes);

  const reminder = await EventReminderPreference.findOneAndUpdate(
    {
      eventId: event._id,
      userId: actorUserId,
    },
    {
      $set: {
        enabled,
        offsetsMinutes,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  return {
    enabled: reminder.enabled !== false,
    offsetsMinutes: normalizeReminderOffsets(reminder.offsetsMinutes),
    isDefault: false,
    updatedAt: reminder.updatedAt,
  };
};

const EVENT_CHAT_DELETED_TEXT = "This message was deleted";

const applyEventChatMessagePopulate = (query) =>
  query
    .populate("userId", "fullName email avatarUrl title")
    .populate({
      path: "replyToMessageId",
      select: "_id message messageType userId isDeleted deletedAt createdAt",
      populate: {
        path: "userId",
        select: "fullName email avatarUrl title",
      },
    })
    .populate({
      path: "forwardedFromMessageId",
      select: "_id message messageType userId isDeleted deletedAt createdAt",
      populate: {
        path: "userId",
        select: "fullName email avatarUrl title",
      },
    });

const resolveEventChatTicketCard = async ({ eventId, ticketRef, actorUserId }) => {
  const trimmedRef = String(ticketRef || "").trim();

  if (!trimmedRef) {
    throw new ApiError(400, "ticketRef is required");
  }

  let ticket = null;

  if (objectIdRegex.test(trimmedRef)) {
    ticket = await EventTicket.findById(trimmedRef);
  }

  if (!ticket) {
    ticket = await EventTicket.findOne({
      $or: [{ ticketCode: trimmedRef }, { barcodeValue: trimmedRef }],
      eventId,
    });
  }

  if (!ticket || String(ticket.eventId) !== String(eventId)) {
    throw new ApiError(404, "Ticket not found for this event");
  }

  const actorId = String(actorUserId);
  const buyerId = String(ticket.buyerUserId || "");
  const organizerId = String(ticket.organizerUserId || "");

  if (actorId !== buyerId && actorId !== organizerId) {
    throw new ApiError(403, "You cannot share this ticket");
  }

  return {
    ticketId: String(ticket._id),
    ticketCode: ticket.ticketCode || "",
    barcodeValue: ticket.barcodeValue || ticket.ticketCode || String(ticket._id),
    status: ticket.status || "pending",
  };
};

const resolveEventChatReplyPreview = async ({ eventId, replyToMessageId }) => {
  const replyId = String(replyToMessageId || "").trim();

  if (!replyId) {
    return null;
  }

  const message = await EventChatMessage.findOne({
    _id: replyId,
    eventId,
  })
    .populate("userId", "fullName email avatarUrl title")
    .select("_id message messageType userId isDeleted deletedAt");

  if (!message) {
    throw new ApiError(404, "Reply target message not found");
  }

  return {
    _id: String(message._id),
    message: message.isDeleted ? EVENT_CHAT_DELETED_TEXT : message.message || "",
    messageType: message.messageType || "text",
    sender:
      typeof message.userId === "object" && message.userId
        ? {
            _id: String(message.userId._id),
            fullName: message.userId.fullName || "Vera user",
          }
        : null,
    isDeleted: message.isDeleted === true,
  };
};

const resolveEventChatForwardPreview = async ({
  eventId,
  forwardedFromMessageId,
}) => {
  const forwardedId = String(forwardedFromMessageId || "").trim();

  if (!forwardedId) {
    return null;
  }

  const message = await EventChatMessage.findOne({
    _id: forwardedId,
    eventId,
  })
    .populate("userId", "fullName email avatarUrl title")
    .select("_id message messageType userId isDeleted deletedAt");

  if (!message) {
    throw new ApiError(404, "Forward source message not found");
  }

  return {
    _id: String(message._id),
    message: message.isDeleted ? EVENT_CHAT_DELETED_TEXT : message.message || "",
    messageType: message.messageType || "text",
    sender:
      typeof message.userId === "object" && message.userId
        ? {
            _id: String(message.userId._id),
            fullName: message.userId.fullName || "Vera user",
          }
        : null,
    isDeleted: message.isDeleted === true,
  };
};

const buildEventChatWrite = async ({ event, actorUserId, payload }) => {
  const normalized = normalizeMessagePayload({
    payload,
    allowEventCard: false,
  });
  const metadata = normalized.metadata || {};

  if (normalized.messageType === "ticket") {
    metadata.ticket = await resolveEventChatTicketCard({
      eventId: event._id,
      ticketRef: metadata.ticketRef,
      actorUserId,
    });
  }

  const replyPreview = await resolveEventChatReplyPreview({
    eventId: event._id,
    replyToMessageId: normalized.replyToMessageId,
  });

  if (replyPreview) {
    metadata.replyPreview = replyPreview;
  } else {
    delete metadata.replyPreview;
  }

  const forwardedPreview = await resolveEventChatForwardPreview({
    eventId: event._id,
    forwardedFromMessageId: normalized.forwardedFromMessageId,
  });

  if (forwardedPreview) {
    metadata.forwardedPreview = forwardedPreview;
  } else {
    delete metadata.forwardedPreview;
  }

  return {
    message: normalized.message,
    messageType: normalized.messageType,
    metadata,
    replyToMessageId: normalized.replyToMessageId || null,
    forwardedFromMessageId: normalized.forwardedFromMessageId || null,
  };
};

const hydrateEventChatMessageById = async (messageId) => {
  const message = await applyEventChatMessagePopulate(
    EventChatMessage.findById(messageId),
  );

  if (!message) {
    throw new ApiError(404, "Chat message not found");
  }

  return message;
};

const listEventChatMessages = async ({
  eventId,
  actorUserId,
  page = 1,
  limit = 25,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(60, Math.max(1, Number(limit) || 25));
  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    applyEventChatMessagePopulate(
      EventChatMessage.find({ eventId: event._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    EventChatMessage.countDocuments({ eventId: event._id }),
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

const createEventChatMessage = async ({ eventId, actorUserId, payload }) => {
  const event = await Event.findById(eventId).populate(
    "organizerUserId",
    "fullName email avatarUrl title",
  );

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const messageInput = await buildEventChatWrite({
    event,
    actorUserId,
    payload,
  });

  const message = await EventChatMessage.create({
    eventId: event._id,
    userId: actorUserId,
    message: messageInput.message,
    messageType: messageInput.messageType,
    metadata: messageInput.metadata,
    replyToMessageId: messageInput.replyToMessageId,
    forwardedFromMessageId: messageInput.forwardedFromMessageId,
  });

  const hydratedMessage = await hydrateEventChatMessageById(message._id);

  const organizerUserId = toIdString(event.organizerUserId);

  if (organizerUserId && organizerUserId !== String(actorUserId)) {
    void createNotification({
      userId: organizerUserId,
      type: "event.chat.message",
      title: `New chat in ${event.name}`,
      message: `${hydratedMessage.userId?.fullName || "Attendee"} sent a message.`,
      data: {
        target: "event-chat",
        eventId: String(event._id),
      },
      push: true,
    }).catch(() => null);
  }

  return hydratedMessage;
};

const updateEventChatMessage = async ({
  eventId,
  actorUserId,
  messageId,
  payload,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const existing = await EventChatMessage.findOne({
    _id: messageId,
    eventId: event._id,
  }).select("_id userId messageType isDeleted");

  if (!existing) {
    throw new ApiError(404, "Chat message not found");
  }

  if (String(existing.userId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only edit your own message");
  }

  if (existing.isDeleted) {
    throw new ApiError(400, "Deleted messages cannot be edited");
  }

  if (existing.messageType !== "text") {
    throw new ApiError(400, "Only text messages can be edited");
  }

  const normalized = normalizeMessagePayload({
    payload: {
      ...(payload || {}),
      messageType: "text",
    },
    allowEventCard: false,
  });

  await EventChatMessage.updateOne(
    { _id: existing._id },
    {
      $set: {
        message: normalized.message,
        editedAt: new Date(),
      },
    },
  );

  return hydrateEventChatMessageById(existing._id);
};

const deleteEventChatMessage = async ({ eventId, actorUserId, messageId }) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const existing = await EventChatMessage.findOne({
    _id: messageId,
    eventId: event._id,
  }).select("_id userId isDeleted");

  if (!existing) {
    throw new ApiError(404, "Chat message not found");
  }

  if (String(existing.userId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only unsend your own message");
  }

  if (!existing.isDeleted) {
    await EventChatMessage.updateOne(
      { _id: existing._id },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          editedAt: new Date(),
          message: EVENT_CHAT_DELETED_TEXT,
          metadata: {},
          replyToMessageId: null,
          forwardedFromMessageId: null,
        },
      },
    );
  }

  return hydrateEventChatMessageById(existing._id);
};

const listEventPosts = async ({
  eventId,
  actorUserId,
  page = 1,
  limit = 20,
}) => {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);

  const isParticipant =
    toIdString(event.organizerUserId) === String(actorUserId) ||
    (await userHasEventTicket({
      eventId: event._id,
      userId: actorUserId,
    }));

  const query = {
    eventId: event._id,
  };

  if (!isParticipant) {
    query.visibility = "public";
  }

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    EventPost.find(query)
      .populate("authorUserId", "fullName email avatarUrl title")
      .populate("eventId", "name imageUrl address")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    EventPost.countDocuments(query),
  ]);

  const likeSet = await getPostLikeMapForActor({
    postIds: items.map((item) => item._id),
    actorUserId,
  });

  return {
    items: items.map((item) =>
      mapEventPostForResponse({
        post: item,
        likedByMe: likeSet.has(String(item._id)),
      }),
    ),
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const createEventPost = async ({ eventId, actorUserId, payload }) => {
  const event = await Event.findById(eventId).populate(
    "organizerUserId",
    "fullName email avatarUrl title",
  );

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await ensureEventCanBeViewedBy(event, actorUserId);
  await ensureEventParticipant({ event, actorUserId });

  const caption = String(payload.caption || "").trim();
  const imageUrl = String(payload.imageUrl || "").trim();

  if (!caption && !imageUrl) {
    throw new ApiError(400, "Add a caption or image to create a post");
  }

  const post = await EventPost.create({
    eventId: event._id,
    authorUserId: actorUserId,
    organizerUserId: event.organizerUserId?._id || event.organizerUserId,
    type: payload.type || "photo",
    caption,
    imageUrl,
    visibility: payload.visibility || "public",
  });

  await post.populate("authorUserId", "fullName email avatarUrl title");
  await post.populate("eventId", "name imageUrl address");

  const organizerUserId = toIdString(event.organizerUserId);

  if (organizerUserId && organizerUserId !== String(actorUserId)) {
    void createNotification({
      userId: organizerUserId,
      type: "event.post.created",
      title: `New post in ${event.name}`,
      message: `${post.authorUserId?.fullName || "Attendee"} added to the event feed.`,
      data: {
        target: "event-post",
        eventId: String(event._id),
      },
      push: true,
    }).catch(() => null);
  }

  return mapEventPostForResponse({
    post,
    likedByMe: false,
  });
};

const toggleEventPostLike = async ({ postId, actorUserId }) => {
  const { post } = await getPostWithAccess({
    postId,
    actorUserId,
    requireParticipant: false,
  });

  const existing = await EventPostLike.findOne({
    postId: post._id,
    userId: actorUserId,
  });

  if (existing) {
    await EventPostLike.deleteOne({ _id: existing._id });
    await EventPost.updateOne(
      { _id: post._id, likesCount: { $gt: 0 } },
      { $inc: { likesCount: -1 } },
    );

    const refreshed = await EventPost.findById(post._id)
      .populate("authorUserId", "fullName email avatarUrl title")
      .populate("eventId", "name imageUrl address");

    return {
      liked: false,
      post: mapEventPostForResponse({
        post: refreshed || post,
        likedByMe: false,
      }),
    };
  }

  await EventPostLike.create({
    postId: post._id,
    eventId: post.eventId?._id || post.eventId,
    userId: actorUserId,
  });
  await EventPost.updateOne({ _id: post._id }, { $inc: { likesCount: 1 } });

  const refreshed = await EventPost.findById(post._id)
    .populate("authorUserId", "fullName email avatarUrl title")
    .populate("eventId", "name imageUrl address");

  return {
    liked: true,
    post: mapEventPostForResponse({
      post: refreshed || post,
      likedByMe: true,
    }),
  };
};

const listEventPostComments = async ({
  postId,
  actorUserId,
  page = 1,
  limit = 25,
}) => {
  const { post } = await getPostWithAccess({
    postId,
    actorUserId,
    requireParticipant: false,
  });

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(80, Math.max(1, Number(limit) || 25));
  const skip = (pageNumber - 1) * limitNumber;

  const [items, totalItems] = await Promise.all([
    EventPostComment.find({ postId: post._id })
      .populate("userId", "fullName email avatarUrl title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    EventPostComment.countDocuments({ postId: post._id }),
  ]);

  return {
    post: mapEventPostForResponse({
      post,
      likedByMe: Boolean(
        await EventPostLike.exists({
          postId: post._id,
          userId: actorUserId,
        }),
      ),
    }),
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const createEventPostComment = async ({
  postId,
  actorUserId,
  payload,
}) => {
  const { post, event, isParticipant } = await getPostWithAccess({
    postId,
    actorUserId,
    requireParticipant: false,
  });
  const commentText = String(payload.comment || "").trim();

  if (!commentText) {
    throw new ApiError(400, "Comment cannot be empty");
  }

  const created = await EventPostComment.create({
    postId: post._id,
    eventId: event._id,
    userId: actorUserId,
    comment: commentText,
  });

  await created.populate("userId", "fullName email avatarUrl title");
  await EventPost.updateOne({ _id: post._id }, { $inc: { commentsCount: 1 } });

  if (toIdString(post.authorUserId) !== String(actorUserId)) {
    void createNotification({
      userId: toIdString(post.authorUserId),
      type: "event.post.comment",
      title: `New comment on ${event.name}`,
      message: `${created.userId?.fullName || "Someone"} commented on your post.`,
      data: {
        target: "event-post",
        eventId: String(event._id),
        postId: String(post._id),
      },
      push: true,
    }).catch(() => null);
  }

  return {
    comment: created,
    canModerate: isParticipant || toIdString(post.authorUserId) === String(actorUserId),
  };
};

const listEventFeed = async ({
  actorUserId,
  page = 1,
  limit = 20,
  scope = "global",
  search,
}) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNumber - 1) * limitNumber;
  const query = {};

  if (scope === "mine") {
    const [myEventRows, myTicketRows] = await Promise.all([
      Event.find({
        organizerUserId: actorUserId,
      })
        .select("_id")
        .limit(5000)
        .lean(),
      EventTicket.find({
        buyerUserId: actorUserId,
        status: { $in: ["pending", "paid", "used"] },
      })
        .select("eventId")
        .limit(5000)
        .lean(),
    ]);

    const eventIds = [
      ...new Set(
        [
          ...myEventRows.map((row) => String(row._id)),
          ...myTicketRows.map((row) => String(row.eventId)),
        ].filter((value) => objectIdRegex.test(value)),
      ),
    ];

    if (!eventIds.length) {
      return {
        items: [],
        ...buildPaginationMeta({
          page: pageNumber,
          limit: limitNumber,
          totalItems: 0,
        }),
      };
    }

    query.eventId = {
      $in: toObjectIds(eventIds),
    };
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");

    const matchingEvents = await Event.find({
      $or: [{ name: pattern }, { address: pattern }],
    })
      .select("_id")
      .limit(4000)
      .lean();

    const eventIds = matchingEvents.map((item) => item._id);

    query.$or = [{ caption: pattern }];

    if (eventIds.length) {
      query.$or.push({ eventId: { $in: eventIds } });
    }
  }

  const [items, totalItems] = await Promise.all([
    EventPost.find(query)
      .populate({
        path: "eventId",
        select:
          "name imageUrl address status startsAt endsAt recurrence organizerUserId ticketPriceNaira isPaid expectedTickets pricing",
        populate: {
          path: "organizerUserId",
          select: "fullName email avatarUrl title",
        },
      })
      .populate("authorUserId", "fullName email avatarUrl title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    EventPost.countDocuments(query),
  ]);

  const filteredItems = items.filter((item) => item.eventId);
  const likeSet = await getPostLikeMapForActor({
    postIds: filteredItems.map((item) => item._id),
    actorUserId,
  });

  return {
    items: filteredItems.map((item) =>
      mapEventPostForResponse({
        post: item,
        likedByMe: likeSet.has(String(item._id)),
      }),
    ),
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
  listEventFeed,
  listMyEvents,
  listFeaturedEvents,
  getEventById,
  getOrganizerProfileById,
  listEventRatings,
  rateEvent,
  getEventReminder,
  upsertEventReminder,
  listEventChatMessages,
  createEventChatMessage,
  updateEventChatMessage,
  deleteEventChatMessage,
  listEventPosts,
  createEventPost,
  toggleEventPostLike,
  listEventPostComments,
  createEventPostComment,
  updateEvent,
  deleteEvent,
  initializeTicketPurchase,
  verifyTicketPayment,
  checkInTicket,
  listMyTickets,
  listOrganizerTicketSales,
  getTicketById,
  listEventResaleMarketplace,
  createTicketResale,
  cancelTicketResale,
  listTicketResaleBids,
  createTicketResaleBid,
  acceptTicketResaleBid,
  rejectTicketResaleBid,
  purchaseResaleTicket,
  initializeResalePurchase,
  verifyResalePurchase,
  listTicketTodos,
  createTicketTodo,
  updateTicketTodo,
  deleteTicketTodo,
  listEventTickets,
  resolveOccurrenceWindow,
  normalizeRecurrence,
  expireAcceptedResaleOfferById,
  processPaystackWebhookEvent,
};
