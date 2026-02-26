const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  paginationQuerySchema,
  startDirectConversationSchema,
  conversationIdParamsSchema,
  sendDirectMessageSchema,
} = require("../validations/chat.validation");
const {
  listChatThreadsController,
  discoverChatUsersController,
  startDirectConversationController,
  listDirectMessagesController,
  sendDirectMessageController,
} = require("../controllers/chat.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/threads", validateQuery(paginationQuerySchema), listChatThreadsController);
router.get("/users", validateQuery(paginationQuerySchema), discoverChatUsersController);
router.post("/direct", validateBody(startDirectConversationSchema), startDirectConversationController);
router.get(
  "/direct/:conversationId/messages",
  validateParams(conversationIdParamsSchema),
  validateQuery(paginationQuerySchema),
  listDirectMessagesController,
);
router.post(
  "/direct/:conversationId/messages",
  validateParams(conversationIdParamsSchema),
  validateBody(sendDirectMessageSchema),
  sendDirectMessageController,
);

module.exports = router;
