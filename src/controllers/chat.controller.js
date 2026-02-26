const asyncHandler = require("../utils/async-handler");
const {
  createOrGetDirectConversation,
  listDirectMessages,
  sendDirectMessage,
  listChatThreads,
  discoverChatUsers,
} = require("../services/chat.service");
const {
  emitDirectMessageCreated,
} = require("../realtime/socket-broker");

const listChatThreadsController = asyncHandler(async (req, res) => {
  const result = await listChatThreads({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
  });

  res.status(200).json({
    success: true,
    message: "Chat threads fetched",
    data: result,
  });
});

const discoverChatUsersController = asyncHandler(async (req, res) => {
  const result = await discoverChatUsers({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
  });

  res.status(200).json({
    success: true,
    message: "Users fetched",
    data: result,
  });
});

const startDirectConversationController = asyncHandler(async (req, res) => {
  const conversation = await createOrGetDirectConversation({
    actorUserId: req.auth.userId,
    recipientUserId: req.body.recipientUserId,
  });

  res.status(200).json({
    success: true,
    message: "Conversation ready",
    data: conversation,
  });
});

const listDirectMessagesController = asyncHandler(async (req, res) => {
  const result = await listDirectMessages({
    actorUserId: req.auth.userId,
    conversationId: req.params.conversationId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Messages fetched",
    data: result,
  });
});

const sendDirectMessageController = asyncHandler(async (req, res) => {
  const result = await sendDirectMessage({
    actorUserId: req.auth.userId,
    conversationId: req.params.conversationId,
    message: req.body.message,
  });

  emitDirectMessageCreated({
    conversationId: String(result.conversation._id),
    message: result.message,
    participantUserIds: (result.conversation.participants || []).map((participant) =>
      String(participant?._id || participant),
    ),
  });

  res.status(201).json({
    success: true,
    message: "Message sent",
    data: result,
  });
});

module.exports = {
  listChatThreadsController,
  discoverChatUsersController,
  startDirectConversationController,
  listDirectMessagesController,
  sendDirectMessageController,
};
