const asyncHandler = require("../utils/async-handler");
const { getTicketReceipt, emailTicketReceipt } = require("../services/receipt.service");
const {
  createTicketTransfer,
  cancelTicketTransfer,
  listIncomingTransfers,
  getTransferByToken,
  acceptTicketTransfer,
  declineTicketTransfer,
} = require("../services/ticket-transfer.service");
const { getMyWaitlistStatus, joinWaitlist, leaveWaitlist } = require("../services/event-waitlist.service");
const {
  saveEvent,
  unsaveEvent,
  listSavedEventIds,
  listSavedEvents,
  importSavedEvents,
} = require("../services/saved-event.service");

/* Receipts, sending tickets to friends, waitlists and saved events: the
   holder-side extras around a ticket. */

const respond = (res, message, data, status = 200) =>
  res.status(status).json({ success: true, message, data });

const getTicketReceiptController = asyncHandler(async (req, res) =>
  respond(res, "Receipt fetched", await getTicketReceipt({ ticketId: req.params.ticketId, actorUserId: req.auth.userId })),
);

const emailTicketReceiptController = asyncHandler(async (req, res) =>
  respond(res, "Receipt sent", await emailTicketReceipt({ ticketId: req.params.ticketId, actorUserId: req.auth.userId })),
);

const createTicketTransferController = asyncHandler(async (req, res) =>
  respond(
    res,
    "Ticket sent",
    await createTicketTransfer({ ticketId: req.params.ticketId, actorUserId: req.auth.userId, payload: req.body }),
    201,
  ),
);

const cancelTicketTransferController = asyncHandler(async (req, res) =>
  respond(res, "Send cancelled", await cancelTicketTransfer({ ticketId: req.params.ticketId, actorUserId: req.auth.userId })),
);

const listIncomingTransfersController = asyncHandler(async (req, res) =>
  respond(res, "Incoming tickets fetched", await listIncomingTransfers({ actorUserId: req.auth.userId })),
);

const getTransferByTokenController = asyncHandler(async (req, res) =>
  respond(res, "Ticket send fetched", await getTransferByToken({ token: req.params.token, actorUserId: req.auth.userId })),
);

const acceptTicketTransferController = asyncHandler(async (req, res) =>
  respond(res, "Ticket accepted", await acceptTicketTransfer({ transferId: req.params.transferId, actorUserId: req.auth.userId })),
);

const declineTicketTransferController = asyncHandler(async (req, res) =>
  respond(res, "Ticket declined", await declineTicketTransfer({ transferId: req.params.transferId, actorUserId: req.auth.userId })),
);

const getMyWaitlistStatusController = asyncHandler(async (req, res) =>
  respond(res, "Waitlist status fetched", await getMyWaitlistStatus({ eventId: req.params.eventId, actorUserId: req.auth.userId })),
);

const joinWaitlistController = asyncHandler(async (req, res) =>
  respond(res, "Joined waitlist", await joinWaitlist({ eventId: req.params.eventId, actorUserId: req.auth.userId })),
);

const leaveWaitlistController = asyncHandler(async (req, res) =>
  respond(res, "Left waitlist", await leaveWaitlist({ eventId: req.params.eventId, actorUserId: req.auth.userId })),
);

const listSavedEventsController = asyncHandler(async (req, res) =>
  respond(
    res,
    "Saved events fetched",
    await listSavedEvents({ userId: req.auth.userId, scope: req.query.scope, page: req.query.page, limit: req.query.limit }),
  ),
);

const listSavedEventIdsController = asyncHandler(async (req, res) =>
  respond(res, "Saved event ids fetched", await listSavedEventIds({ userId: req.auth.userId })),
);

const importSavedEventsController = asyncHandler(async (req, res) =>
  respond(res, "Saved events imported", await importSavedEvents({ userId: req.auth.userId, eventIds: req.body.eventIds })),
);

const saveEventController = asyncHandler(async (req, res) =>
  respond(res, "Event saved", await saveEvent({ userId: req.auth.userId, eventId: req.params.eventId })),
);

const unsaveEventController = asyncHandler(async (req, res) =>
  respond(res, "Event unsaved", await unsaveEvent({ userId: req.auth.userId, eventId: req.params.eventId })),
);

module.exports = {
  listSavedEventsController,
  listSavedEventIdsController,
  importSavedEventsController,
  saveEventController,
  unsaveEventController,
  getTicketReceiptController,
  emailTicketReceiptController,
  createTicketTransferController,
  cancelTicketTransferController,
  listIncomingTransfersController,
  getTransferByTokenController,
  acceptTicketTransferController,
  declineTicketTransferController,
  getMyWaitlistStatusController,
  joinWaitlistController,
  leaveWaitlistController,
};
