const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateBody, validateParams, validateQuery } = require("../middlewares/validate.middleware");
const v = require("../validations/together.validation");
const c = require("../controllers/together.controller");

/* Going to an event together: a group, its tickets, and who owes what. */
const router = express.Router();

router.use(authMiddleware);

router.get("/", validateQuery(v.listGroupsQuerySchema), c.listGroupsController);
router.post("/", validateBody(v.startGroupSchema), c.startGroupController);

router.post("/shares/:shareId/on-me", validateParams(v.shareParamsSchema), c.coverShareController);
router.post("/shares/:shareId/nudge", validateParams(v.shareParamsSchema), c.nudgeController);
router.post("/shares/:shareId/pay", validateParams(v.shareParamsSchema), validateBody(v.startPaymentSchema), c.startPaymentController);
router.post("/shares/:shareId/verify", validateParams(v.shareParamsSchema), validateBody(v.verifyPaymentSchema), c.verifyPaymentController);

router.get("/:groupId", validateParams(v.groupParamsSchema), c.getGroupController);
router.post("/:groupId/invites", validateParams(v.groupParamsSchema), validateBody(v.inviteSchema), c.inviteController);
router.post("/:groupId/respond", validateParams(v.groupParamsSchema), validateBody(v.respondSchema), c.respondController);
router.post("/:groupId/leave", validateParams(v.groupParamsSchema), c.leaveController);
router.post("/:groupId/members/:userId/remind", validateParams(v.memberParamsSchema), c.remindController);
router.get("/:groupId/suggestions", validateParams(v.groupParamsSchema), c.suggestionsController);
router.post("/:groupId/tickets", validateParams(v.groupParamsSchema), validateBody(v.sendTicketSchema), c.sendTicketController);

module.exports = router;
