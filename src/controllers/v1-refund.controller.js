const asyncHandler = require("../utils/async-handler");
const { sendV1Success } = require("../utils/v1-response");
const { refundTicketForWorkspace } = require("../services/v1-refund.service");

const createRefundController = asyncHandler(async (req, res) => {
  const result = await refundTicketForWorkspace({
    workspaceId: req.apiAuth.workspaceId,
    ticketId: req.body.ticketId,
    reason: req.body.reason,
  });

  sendV1Success(res, { data: result });
});

module.exports = { createRefundController };
