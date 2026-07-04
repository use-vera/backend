const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  userIdParamsSchema,
  listConnectionsQuerySchema,
} = require("../validations/follow.validation");
const {
  followUserController,
  unfollowUserController,
  getFollowStatusController,
  listFollowersController,
  listFollowingController,
} = require("../controllers/follow.controller");

const router = express.Router();

router.use(authMiddleware);

router.post(
  "/:userId",
  validateParams(userIdParamsSchema),
  followUserController,
);
router.delete(
  "/:userId",
  validateParams(userIdParamsSchema),
  unfollowUserController,
);
router.get(
  "/:userId/status",
  validateParams(userIdParamsSchema),
  getFollowStatusController,
);
router.get(
  "/:userId/followers",
  validateParams(userIdParamsSchema),
  validateQuery(listConnectionsQuerySchema),
  listFollowersController,
);
router.get(
  "/:userId/following",
  validateParams(userIdParamsSchema),
  validateQuery(listConnectionsQuerySchema),
  listFollowingController,
);

module.exports = router;
