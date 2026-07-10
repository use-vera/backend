const asyncHandler = require("../utils/async-handler");
const { sendV1Success } = require("../utils/v1-response");
const {
  verifyTicketForWorkspace,
  checkInTicketForWorkspaceApi,
} = require("../services/v1-ticket.service");

const verifyTicketController = asyncHandler(async (req, res) => {
  const result = await verifyTicketForWorkspace({
    workspaceId: req.apiAuth.workspaceId,
    code: req.body.code,
    eventId: req.body.eventId,
  });

  sendV1Success(res, { data: result });
});

const checkInTicketController = asyncHandler(async (req, res) => {
  const result = await checkInTicketForWorkspaceApi({
    workspaceId: req.apiAuth.workspaceId,
    code: req.body.code,
    eventId: req.body.eventId,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    override: req.body.override,
  });

  sendV1Success(res, { data: result });
});

module.exports = { verifyTicketController, checkInTicketController };
