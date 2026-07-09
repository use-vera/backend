const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const { mapOrderTicket } = require("./v1-mappers");

const ORDER_STATUSES = ["paid", "used", "refunded"];

const listWorkspaceOrders = async ({ workspaceId, page = 1, limit = 20 }) => {
  const query = { workspaceId, status: { $in: ORDER_STATUSES } };
  const totalItems = await EventTicket.countDocuments(query);
  const tickets = await EventTicket.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    items: tickets.map(mapOrderTicket),
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: totalPages > 0 ? page < totalPages : false,
    },
  };
};

const getWorkspaceOrder = async ({ workspaceId, ticketId }) => {
  const ticket = await EventTicket.findOne({ _id: ticketId, workspaceId });

  // Cross-tenant orders 404 like they don't exist, not 403 — avoids leaking
  // that a ticket id belongs to someone else's workspace.
  if (!ticket) {
    throw new ApiError(404, "Order not found", null, "NOT_FOUND");
  }

  return mapOrderTicket(ticket);
};

module.exports = { listWorkspaceOrders, getWorkspaceOrder };
