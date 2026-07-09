const ApiError = require("../utils/api-error");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { resolveEventSalePhase } = require("./event.service");
const { mapPublicEvent } = require("./v1-mappers");

// "reserved" mirrors the rest of the purchase pipeline's inventory
// accounting: paid/used tickets plus still-pending (not yet expired)
// reservations all count against capacity.
const RESERVED_STATUSES = ["paid", "used", "pending"];

const sumQuantityByGroupKey = async (matchStage, groupKey) => {
  const rows = await EventTicket.aggregate([
    { $match: matchStage },
    { $group: { _id: groupKey, count: { $sum: "$quantity" } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
};

const getReservedCountsByEvent = (eventIds) =>
  eventIds.length
    ? sumQuantityByGroupKey(
        { eventId: { $in: eventIds }, status: { $in: RESERVED_STATUSES } },
        "$eventId",
      )
    : Promise.resolve(new Map());

const getSoldCountsByEvent = (eventIds) =>
  eventIds.length
    ? sumQuantityByGroupKey(
        { eventId: { $in: eventIds }, status: { $in: ["paid", "used"] } },
        "$eventId",
      )
    : Promise.resolve(new Map());

const loadPublishedWorkspaceEvent = async ({ workspaceId, eventId }) => {
  const event = await Event.findById(eventId);

  if (
    !event ||
    String(event.workspaceId) !== String(workspaceId) ||
    event.status !== "published"
  ) {
    throw new ApiError(404, "Event not found", null, "NOT_FOUND");
  }

  return event;
};

const listWorkspaceEventsForApi = async ({ workspaceId, page = 1, limit = 20 }) => {
  const query = { workspaceId, status: "published" };
  const totalItems = await Event.countDocuments(query);
  const events = await Event.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const eventIds = events.map((event) => event._id);
  const [reservedMap, soldMap] = await Promise.all([
    getReservedCountsByEvent(eventIds),
    getSoldCountsByEvent(eventIds),
  ]);

  const now = new Date();
  const items = events.map((event) => {
    const reserved = reservedMap.get(String(event._id)) || 0;

    return mapPublicEvent({
      event,
      salePhase: resolveEventSalePhase(event, now),
      remainingTickets: Math.max(0, Number(event.expectedTickets || 0) - reserved),
      soldTickets: soldMap.get(String(event._id)) || 0,
    });
  });

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    items,
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: totalPages > 0 ? page < totalPages : false,
    },
  };
};

const getWorkspaceEventForApi = async ({ workspaceId, eventId }) => {
  const event = await loadPublishedWorkspaceEvent({ workspaceId, eventId });
  const [reservedMap, soldMap] = await Promise.all([
    getReservedCountsByEvent([event._id]),
    getSoldCountsByEvent([event._id]),
  ]);
  const reserved = reservedMap.get(String(event._id)) || 0;

  return mapPublicEvent({
    event,
    salePhase: resolveEventSalePhase(event, new Date()),
    remainingTickets: Math.max(0, Number(event.expectedTickets || 0) - reserved),
    soldTickets: soldMap.get(String(event._id)) || 0,
  });
};

const listWorkspaceEventTicketTypesForApi = async ({ workspaceId, eventId }) => {
  const event = await loadPublishedWorkspaceEvent({ workspaceId, eventId });
  const now = new Date();
  const salePhase = resolveEventSalePhase(event, now);
  const hasCategories =
    Array.isArray(event.ticketCategories) && event.ticketCategories.length > 0;

  if (!hasCategories) {
    const reservedMap = await getReservedCountsByEvent([event._id]);
    const reserved = reservedMap.get(String(event._id)) || 0;

    return [
      {
        id: null,
        name: "General admission",
        priceNaira: event.isPaid ? event.ticketPriceNaira : 0,
        quantity: event.expectedTickets,
        remainingQuantity: Math.max(0, Number(event.expectedTickets || 0) - reserved),
        salePhase,
      },
    ];
  }

  const reservedByCategory = await sumQuantityByGroupKey(
    {
      eventId: event._id,
      ticketCategoryId: { $ne: null },
      status: { $in: RESERVED_STATUSES },
    },
    "$ticketCategoryId",
  );

  return event.ticketCategories.map((category) => ({
    id: String(category._id),
    name: category.name,
    priceNaira: category.priceNaira,
    quantity: category.quantity,
    remainingQuantity: Math.max(
      0,
      Number(category.quantity || 0) - (reservedByCategory.get(String(category._id)) || 0),
    ),
    salePhase,
  }));
};

module.exports = {
  listWorkspaceEventsForApi,
  getWorkspaceEventForApi,
  listWorkspaceEventTicketTypesForApi,
};
