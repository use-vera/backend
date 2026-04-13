const mongoose = require("mongoose");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventRating = require("../models/event-rating.model");
const EventCenter = require("../models/event-center.model");
const User = require("../models/user.model");

const VERIFICATION_SUCCESS_THRESHOLD = 5;
const EVENT_CENTER_DEDUPE_RADIUS_METERS = 200;

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const toIdString = (value) => String(value?._id || value || "");

const toObjectIds = (values) =>
  values.map((value) => new mongoose.Types.ObjectId(String(value)));

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value)));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeCenterName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const isValidCoordinate = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
};

const toMeters = (value) => Number((value || 0).toFixed(1));

const haversineDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
};

const getRecurringEndsOnBoundary = (event) => {
  const endsOnValue = event?.recurrence?.endsOn;

  if (!endsOnValue) {
    return null;
  }

  const endsOn = new Date(endsOnValue);

  if (Number.isNaN(endsOn.getTime())) {
    return null;
  }

  endsOn.setHours(23, 59, 59, 999);
  return endsOn;
};

const isEventEndedForVerification = (event, now = new Date()) => {
  if (!event) {
    return false;
  }

  const recurrenceType = String(event?.recurrence?.type || "none").trim();

  if (recurrenceType && recurrenceType !== "none") {
    const recurrenceBoundary = getRecurringEndsOnBoundary(event);

    if (!recurrenceBoundary) {
      return false;
    }

    return now > recurrenceBoundary;
  }

  const endsAt = new Date(event.endsAt);

  if (Number.isNaN(endsAt.getTime())) {
    return false;
  }

  return now > endsAt;
};

const isEventSuccessfulForVerification = (event, usedEventIdSet, now = new Date()) => {
  if (!event || String(event.status) !== "published") {
    return false;
  }

  if (!isEventEndedForVerification(event, now)) {
    return false;
  }

  return usedEventIdSet.has(toIdString(event._id));
};

const getSuccessfulEventCountForEvents = async (events, now = new Date()) => {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      successfulEventsCount: 0,
      usedEventIdSet: new Set(),
    };
  }

  const eventIds = events.map((event) => event._id);
  const usedEventIds = await EventTicket.distinct("eventId", {
    eventId: { $in: eventIds },
    status: "used",
  });
  const usedEventIdSet = new Set(usedEventIds.map((id) => String(id)));
  const successfulEventsCount = events.reduce(
    (count, event) =>
      count + Number(isEventSuccessfulForVerification(event, usedEventIdSet, now)),
    0,
  );

  return {
    successfulEventsCount,
    usedEventIdSet,
  };
};

const recomputeOrganizerVerification = async ({
  organizerUserId,
  now = new Date(),
}) => {
  const organizerId = String(organizerUserId || "").trim();

  if (!objectIdRegex.test(organizerId)) {
    return null;
  }

  const [user, events, attendeeRows] = await Promise.all([
    User.findById(organizerId).select("_id verificationBadge"),
    Event.find({ organizerUserId: organizerId }).select(
      "_id status startsAt endsAt recurrence",
    ),
    EventTicket.aggregate([
      {
        $match: {
          organizerUserId: new mongoose.Types.ObjectId(organizerId),
          status: "used",
        },
      },
      {
        $group: {
          _id: null,
          attendees: { $sum: "$quantity" },
        },
      },
    ]),
  ]);

  if (!user) {
    return null;
  }

  const { successfulEventsCount } = await getSuccessfulEventCountForEvents(events, now);
  const previous = user.verificationBadge || {};
  const verified = successfulEventsCount >= VERIFICATION_SUCCESS_THRESHOLD;
  const verifiedAt = verified
    ? previous.verifiedAt || now
    : null;
  const hostedEventsCount = Number(events.length || 0);
  const cancelledCount = events.reduce(
    (count, event) => count + Number(String(event.status) === "cancelled"),
    0,
  );
  const cancellationRate =
    hostedEventsCount > 0 ? (cancelledCount / hostedEventsCount) * 100 : 0;
  const attendees = Number(attendeeRows[0]?.attendees || 0);

  user.verificationBadge = {
    kind: "organizer",
    threshold: VERIFICATION_SUCCESS_THRESHOLD,
    successfulEventsCount,
    verified,
    verifiedAt,
  };

  await user.save();

  return {
    verified,
    tier: verified ? "trusted" : null,
    score: Math.min(successfulEventsCount, VERIFICATION_SUCCESS_THRESHOLD),
    hostedEventsCount,
    attendees,
    averageRating: 0,
    ratingsCount: 0,
    cancellationRate: Number(cancellationRate.toFixed(1)),
    successfulEventsCount,
    threshold: VERIFICATION_SUCCESS_THRESHOLD,
    verifiedAt,
    kind: "organizer",
    rule: "successfulEvents>=5 (published + ended + >=1 used ticket)",
  };
};

const recomputeEventCenterVerification = async ({
  eventCenterId,
  now = new Date(),
}) => {
  const centerId = String(eventCenterId || "").trim();

  if (!objectIdRegex.test(centerId)) {
    return null;
  }

  const center = await EventCenter.findById(centerId);

  if (!center) {
    return null;
  }

  const events = await Event.find({ eventCenterId: center._id }).select(
    "_id status startsAt endsAt recurrence createdAt updatedAt",
  );
  const { successfulEventsCount } = await getSuccessfulEventCountForEvents(events, now);
  const usageCount = Number(events.length || 0);
  const verified = successfulEventsCount >= VERIFICATION_SUCCESS_THRESHOLD;
  const latestUsedAt =
    events.length > 0
      ? new Date(
          Math.max(...events.map((item) => new Date(item.updatedAt).getTime())),
        )
      : null;

  center.usageCount = usageCount;
  center.successfulEventsCount = successfulEventsCount;
  center.verified = verified;
  center.verifiedAt = verified ? center.verifiedAt || now : null;
  center.lastUsedAt = latestUsedAt;

  await center.save();

  return center;
};

const recomputeVerificationForEvent = async ({
  eventId,
  event,
  now = new Date(),
}) => {
  const targetEvent =
    event ||
    (eventId && objectIdRegex.test(String(eventId))
      ? await Event.findById(eventId).select("_id organizerUserId eventCenterId")
      : null);

  if (!targetEvent) {
    return null;
  }

  await Promise.all([
    recomputeOrganizerVerification({
      organizerUserId: targetEvent.organizerUserId,
      now,
    }),
    recomputeEventCenterVerification({
      eventCenterId: targetEvent.eventCenterId,
      now,
    }),
  ]);

  return targetEvent;
};

const resolveOrUpsertEventCenter = async ({
  eventCenterId,
  address,
  latitude,
  longitude,
}) => {
  const centerId = String(eventCenterId || "").trim();

  if (objectIdRegex.test(centerId)) {
    const existingById = await EventCenter.findById(centerId);

    if (existingById) {
      return existingById;
    }
  }

  const name = String(address || "").trim();

  if (
    !name ||
    !isValidCoordinate(latitude, -90, 90) ||
    !isValidCoordinate(longitude, -180, 180)
  ) {
    return null;
  }

  const normalizedName = normalizeCenterName(name);
  const point = {
    type: "Point",
    coordinates: [Number(longitude), Number(latitude)],
  };

  const existing = await EventCenter.findOne({
    normalizedName,
    location: {
      $nearSphere: {
        $geometry: point,
        $maxDistance: EVENT_CENTER_DEDUPE_RADIUS_METERS,
      },
    },
  });

  if (existing) {
    if (!existing.name || existing.name.length < name.length) {
      existing.name = name;
    }
    existing.latitude = Number(latitude);
    existing.longitude = Number(longitude);
    existing.lastUsedAt = new Date();
    await existing.save();
    return existing;
  }

  return EventCenter.create({
    name,
    normalizedName,
    latitude: Number(latitude),
    longitude: Number(longitude),
    location: point,
    lastUsedAt: new Date(),
  });
};

const buildEventCenterSummary = (center, distanceMeters = null) => ({
  _id: String(center._id),
  name: center.name,
  latitude: Number(center.latitude),
  longitude: Number(center.longitude),
  usageCount: Number(center.usageCount || 0),
  successfulEventsCount: Number(center.successfulEventsCount || 0),
  verified: Boolean(center.verified),
  verifiedAt: center.verifiedAt || null,
  distanceMeters:
    distanceMeters === null || distanceMeters === undefined
      ? null
      : toMeters(distanceMeters),
});

const searchEventCenters = async ({
  query,
  limit = 8,
  latitude,
  longitude,
}) => {
  const text = String(query || "").trim();

  if (!text) {
    return {
      items: [],
    };
  }

  const normalizedQuery = normalizeCenterName(text);
  const normalizedQueryRegex = new RegExp(escapeRegex(normalizedQuery), "i");
  const normalizedQueryPrefixRegex = new RegExp(
    `^${escapeRegex(normalizedQuery)}`,
    "i",
  );
  const safeLimit = clamp(limit || 8, 1, 20);
  const lookupLimit = Math.max(30, safeLimit * 4);
  const hasCoords =
    isValidCoordinate(latitude, -90, 90) &&
    isValidCoordinate(longitude, -180, 180);
  const lat = Number(latitude);
  const lng = Number(longitude);
  const centers = await EventCenter.find({
    normalizedName: normalizedQueryRegex,
  })
    .sort({
      verified: -1,
      successfulEventsCount: -1,
      usageCount: -1,
      lastUsedAt: -1,
      updatedAt: -1,
    })
    .limit(lookupLimit);

  if (centers.length) {
    await Promise.all(
      centers.map((center) =>
        recomputeEventCenterVerification({ eventCenterId: center._id }),
      ),
    );
  }

  const refreshedCenters = centers.length
    ? await EventCenter.find({
        _id: { $in: centers.map((center) => center._id) },
      })
    : [];

  const ranked = refreshedCenters
    .map((center) => {
      const normalizedName = normalizeCenterName(center.name);
      const startsWith = normalizedQueryPrefixRegex.test(normalizedName);
      const includes = normalizedName.includes(normalizedQuery);
      const distanceMeters = hasCoords
        ? haversineDistanceMeters(
            lat,
            lng,
            Number(center.latitude),
            Number(center.longitude),
          )
        : null;
      const rankScore =
        (startsWith ? 120 : includes ? 80 : 0) +
        (center.verified ? 40 : 0) +
        Math.min(
          30,
          Number(center.successfulEventsCount || 0) * 2 +
            Number(center.usageCount || 0) * 0.4,
        ) -
        (distanceMeters !== null ? Math.min(60, distanceMeters / 50) : 0);

      return {
        center,
        distanceMeters,
        rankScore,
      };
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }

      if (a.distanceMeters !== null && b.distanceMeters !== null) {
        return a.distanceMeters - b.distanceMeters;
      }

      return String(a.center.name).localeCompare(String(b.center.name));
    })
    .slice(0, safeLimit);

  return {
    items: ranked.map((item) =>
      buildEventCenterSummary(item.center, item.distanceMeters),
    ),
  };
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
  let users = await User.find({ _id: { $in: objectIds } }).select(
    "_id verificationBadge",
  );
  const staleOrganizerIds = users
    .filter((item) => !item?.verificationBadge?.kind)
    .map((item) => String(item._id));

  if (staleOrganizerIds.length) {
    await Promise.all(
      staleOrganizerIds.map((organizerId) =>
        recomputeOrganizerVerification({ organizerUserId: organizerId }),
      ),
    );
    users = await User.find({ _id: { $in: objectIds } }).select(
      "_id verificationBadge",
    );
  }

  const [eventStatsRows, attendeeRows, ratingRows, organizerEvents, usedTickets] = await Promise.all([
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
          status: "used",
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
    Event.find({
      organizerUserId: { $in: objectIds },
    }).select("_id organizerUserId status endsAt recurrence"),
    EventTicket.find({
      organizerUserId: { $in: objectIds },
      status: "used",
    }).select("organizerUserId eventId"),
  ]);

  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const eventStatsMap = new Map(
    eventStatsRows.map((row) => [
      String(row._id),
      {
        hostedEventsCount: Number(row.hostedEventsCount || 0),
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
  const organizerEventsMap = new Map();
  const usedEventIdsByOrganizer = new Map();

  for (const event of organizerEvents) {
    const organizerId = toIdString(event.organizerUserId);
    const existing = organizerEventsMap.get(organizerId) || [];
    existing.push(event);
    organizerEventsMap.set(organizerId, existing);
  }

  for (const ticket of usedTickets) {
    const organizerId = toIdString(ticket.organizerUserId);
    const existing = usedEventIdsByOrganizer.get(organizerId) || new Set();
    existing.add(toIdString(ticket.eventId));
    usedEventIdsByOrganizer.set(organizerId, existing);
  }

  const result = new Map();

  for (const organizerId of normalizedIds) {
    const organizerUser = userMap.get(organizerId);
    const eventStats = eventStatsMap.get(organizerId) || {
      hostedEventsCount: 0,
      cancelledCount: 0,
    };
    const ratingStats = ratingMap.get(organizerId) || {
      averageRating: 0,
      ratingsCount: 0,
    };
    const eventsForOrganizer = organizerEventsMap.get(organizerId) || [];
    const usedSet = usedEventIdsByOrganizer.get(organizerId) || new Set();
    const successfulEventsCount = eventsForOrganizer.reduce(
      (count, event) =>
        count + Number(isEventSuccessfulForVerification(event, usedSet)),
      0,
    );
    const threshold = VERIFICATION_SUCCESS_THRESHOLD;
    const verified = successfulEventsCount >= threshold;
    const previousVerificationBadge = organizerUser?.verificationBadge || {};
    const verifiedAt = verified
      ? previousVerificationBadge.verifiedAt || new Date()
      : null;
    const cancellationRate =
      eventStats.hostedEventsCount > 0
        ? (eventStats.cancelledCount / eventStats.hostedEventsCount) * 100
        : 0;

    if (
      organizerUser &&
      (Boolean(previousVerificationBadge.verified) !== verified ||
        Number(previousVerificationBadge.successfulEventsCount || 0) !==
          successfulEventsCount ||
        Number(previousVerificationBadge.threshold || 0) !== threshold)
    ) {
      organizerUser.verificationBadge = {
        kind: "organizer",
        verified,
        successfulEventsCount,
        threshold,
        verifiedAt,
      };
      await organizerUser.save();
    }

    result.set(organizerId, {
      verified,
      tier: verified ? "trusted" : null,
      score: Math.min(successfulEventsCount, threshold),
      hostedEventsCount: eventStats.hostedEventsCount,
      attendees: Number(attendeeMap.get(organizerId) || 0),
      averageRating: Number(ratingStats.averageRating.toFixed(2)),
      ratingsCount: Number(ratingStats.ratingsCount || 0),
      cancellationRate: Number(cancellationRate.toFixed(1)),
      successfulEventsCount,
      threshold,
      verifiedAt,
      kind: "organizer",
      rule: "successfulEvents>=5 (published + ended + >=1 used ticket)",
    });
  }

  return result;
};

module.exports = {
  VERIFICATION_SUCCESS_THRESHOLD,
  EVENT_CENTER_DEDUPE_RADIUS_METERS,
  normalizeCenterName,
  resolveOrUpsertEventCenter,
  searchEventCenters,
  recomputeOrganizerVerification,
  recomputeEventCenterVerification,
  recomputeVerificationForEvent,
  getOrganizerVerificationMap,
};
