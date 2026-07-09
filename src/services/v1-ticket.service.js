const { verifyTicketByCode, checkInTicketForWorkspace } = require("./event.service");
const { mapOrderTicket } = require("./v1-mappers");

const verifyTicketForWorkspace = async ({ workspaceId, code, eventId }) => {
  const result = await verifyTicketByCode({ code, eventId, workspaceId });

  return {
    valid: result.isUsable,
    alreadyCheckedIn: result.isUsed,
    checkedInAt: result.checkedInAt,
    reason: result.reason,
    ticket: mapOrderTicket(result.ticket),
    event: {
      id: String(result.event._id),
      name: result.event.name,
    },
  };
};

const checkInTicketForWorkspaceApi = async ({ workspaceId, code, eventId }) => {
  const result = await checkInTicketForWorkspace({
    workspaceId,
    payload: { code, eventId },
  });

  return {
    alreadyCheckedIn: result.alreadyUsed,
    checkedInAt: result.checkedInAt,
    ticket: mapOrderTicket(result.ticket),
  };
};

module.exports = { verifyTicketForWorkspace, checkInTicketForWorkspaceApi };
