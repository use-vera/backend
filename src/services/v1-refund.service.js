const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const { refundTicket } = require("./refund.service");
const { mapOrderTicket } = require("./v1-mappers");

/**
 * refundTicket({ticketId, actorUserId, reason}) is used completely
 * unmodified — its actorUserId is used only for an isBuyer||isOrganizer
 * check. Since workspace ownership is already established independently
 * here, we satisfy that check by passing the ticket's actual organizer
 * (not the workspace owner, which can diverge from it).
 */
const refundTicketForWorkspace = async ({ workspaceId, ticketId, reason }) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket || String(ticket.workspaceId) !== String(workspaceId)) {
    throw new ApiError(404, "Order not found", null, "NOT_FOUND");
  }

  const refunded = await refundTicket({
    ticketId,
    actorUserId: ticket.organizerUserId,
    reason,
  });

  return mapOrderTicket(refunded);
};

module.exports = { refundTicketForWorkspace };
