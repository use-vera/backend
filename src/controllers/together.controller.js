const asyncHandler = require("../utils/async-handler");
const together = require("../services/together.service");

const ok = (res, status, message, data) => res.status(status).json({ success: true, message, data });
const actor = (req) => req.auth.userId;

module.exports = {
  listGroupsController: asyncHandler(async (req, res) =>
    ok(res, 200, "Groups fetched", await together.listMyGroups({ actorUserId: actor(req), eventId: req.query.eventId })),
  ),
  startGroupController: asyncHandler(async (req, res) =>
    ok(res, 201, "Group ready", await together.startGroup({ actorUserId: actor(req), eventId: req.body.eventId })),
  ),
  getGroupController: asyncHandler(async (req, res) =>
    ok(res, 200, "Group fetched", await together.getGroup({ actorUserId: actor(req), groupId: req.params.groupId })),
  ),
  inviteController: asyncHandler(async (req, res) =>
    ok(res, 200, "Invites sent", await together.invite({ actorUserId: actor(req), groupId: req.params.groupId, userIds: req.body.userIds })),
  ),
  respondController: asyncHandler(async (req, res) =>
    ok(res, 200, "Answered", await together.respond({ actorUserId: actor(req), groupId: req.params.groupId, accept: req.body.accept })),
  ),
  leaveController: asyncHandler(async (req, res) =>
    ok(res, 200, "Left the group", await together.leave({ actorUserId: actor(req), groupId: req.params.groupId })),
  ),
  remindController: asyncHandler(async (req, res) =>
    ok(res, 200, "Reminder sent", await together.remind({ actorUserId: actor(req), groupId: req.params.groupId, userId: req.params.userId })),
  ),
  suggestionsController: asyncHandler(async (req, res) =>
    ok(res, 200, "Suggestions fetched", await together.suggestions({ actorUserId: actor(req), groupId: req.params.groupId })),
  ),
  sendTicketController: asyncHandler(async (req, res) =>
    ok(res, 201, "Ticket sent", await together.sendTicket({ actorUserId: actor(req), groupId: req.params.groupId, ...req.body })),
  ),
  coverShareController: asyncHandler(async (req, res) =>
    ok(res, 200, "It's on you", await together.coverShare({ actorUserId: actor(req), shareId: req.params.shareId })),
  ),
  nudgeController: asyncHandler(async (req, res) =>
    ok(res, 200, "Nudge sent", await together.nudge({ actorUserId: actor(req), shareId: req.params.shareId })),
  ),
  startPaymentController: asyncHandler(async (req, res) =>
    ok(res, 201, "Payment started", await together.startSharePayment({ actorUserId: actor(req), shareId: req.params.shareId, callbackUrl: req.body.callbackUrl })),
  ),
  verifyPaymentController: asyncHandler(async (req, res) =>
    ok(res, 200, "Payment checked", await together.verifySharePayment({ actorUserId: actor(req), shareId: req.params.shareId, reference: req.body.reference })),
  ),
};
