let io = null;

const setSocketServer = (serverInstance) => {
  io = serverInstance || null;
};

const emitEventChatMessageCreated = ({ eventId, message }) => {
  if (!io || !eventId || !message) {
    return;
  }

  io.to(`event:${eventId}`).emit("event:message:new", {
    eventId: String(eventId),
    message,
  });
};

const emitDirectMessageCreated = ({
  conversationId,
  message,
  participantUserIds = [],
}) => {
  if (!io || !conversationId || !message) {
    return;
  }

  io.to(`direct:${conversationId}`).emit("direct:message:new", {
    conversationId: String(conversationId),
    message,
  });

  const participants = [...new Set(
    (Array.isArray(participantUserIds) ? participantUserIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];

  for (const userId of participants) {
    io.to(`user:${userId}`).emit("direct:message:new", {
      conversationId: String(conversationId),
      message,
    });
  }
};

module.exports = {
  setSocketServer,
  emitEventChatMessageCreated,
  emitDirectMessageCreated,
};
