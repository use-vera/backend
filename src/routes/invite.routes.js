const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateParams } = require("../middlewares/validate.middleware");
const { inviteParamsSchema } = require("../validations/invite.validation");
const {
  listMyInvitesController,
  acceptInviteController,
  declineInviteController,
} = require("../controllers/invite.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/me", listMyInvitesController);
router.post("/:inviteId/accept", validateParams(inviteParamsSchema), acceptInviteController);
router.post("/:inviteId/decline", validateParams(inviteParamsSchema), declineInviteController);

module.exports = router;
