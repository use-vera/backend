const { Server } = require("socket.io");
const env = require("../config/env");
const { verifyAccessToken } = require("../utils/jwt");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const DirectConversation = require("../models/direct-conversation.model");
const { createEventChatMessage } = require("../services/event.service");
const { sendDirectMessage } = require("../services/chat.service");
const { setSocketServer } = require("./socket-broker");

const getAllowedOrigins = () => {
  if (env.corsOrigins.includes("*")) {
    return true;
  }

  return env.corsOrigins;
};

const parseTokenFromSocket = (socket) => {
  const authToken = String(socket.handshake?.auth?.token || "").trim();

  if (authToken) {
    return authToken;
  }

  const header = String(socket.handshake?.headers?.authorization || "").trim();

  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  return "";
};

const ensureEventAccessForChat = async ({ eventId, userId }) => {
  const event = await Event.findById(eventId).select("_id organizerUserId");

  if (!event) {
    throw new Error("Event not found");
  }

  if (String(event.organizerUserId) === String(userId)) {
    return event;
  }

  const hasTicket = await EventTicket.exists({
    eventId: event._id,
    buyerUserId: userId,
    status: { $in: ["pending", "paid", "used"] },
  });

  if (!hasTicket) {
    throw new Error("Not authorized for event chat");
  }

  return event;
};

const ensureDirectConversationAccess = async ({ conversationId, userId }) => {
  const conversation = await DirectConversation.findById(conversationId).select(
    "_id participants",
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const allowed = conversation.participants
    .map((item) => String(item))
    .includes(String(userId));

  if (!allowed) {
    throw new Error("Not authorized for this conversation");
  }

  return conversation;
};

const normalizeText = (value) => String(value || "").trim();

const initializeSocketServer = ({ httpServer }) => {
  const io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: env.corsAllowCredentials,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    try {
      const token = parseTokenFromSocket(socket);

      if (!token) {
        next(new Error("Authentication token is required"));
        return;
      }

      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.userId).select("_id");

      if (!user) {
        next(new Error("Authenticated user was not found"));
        return;
      }

      socket.data.userId = String(user._id);
      next();
    } catch (error) {
      next(new Error(error instanceof Error ? error.message : "Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.data.userId || "");

    socket.join(`user:${userId}`);
    socket.emit("socket:ready", {
      userId,
      connectedAt: new Date().toISOString(),
    });

    socket.on("event:join", async (payload, callback) => {
      try {
        const eventId = normalizeText(payload?.eventId);
        await ensureEventAccessForChat({ eventId, userId });
        socket.join(`event:${eventId}`);
        callback?.({ ok: true, eventId });
      } catch (error) {
        callback?.({
          ok: false,
          message: error instanceof Error ? error.message : "Could not join event",
        });
      }
    });

    socket.on("event:leave", (payload, callback) => {
      const eventId = normalizeText(payload?.eventId);

      if (!eventId) {
        callback?.({ ok: false, message: "eventId is required" });
        return;
      }

      socket.leave(`event:${eventId}`);
      callback?.({ ok: true, eventId });
    });

    socket.on("event:message:send", async (payload, callback) => {
      try {
        const eventId = normalizeText(payload?.eventId);
        const message = normalizeText(payload?.message);

        if (!eventId || !message) {
          callback?.({ ok: false, message: "eventId and message are required" });
          return;
        }

        await ensureEventAccessForChat({ eventId, userId });

        const created = await createEventChatMessage({
          eventId,
          actorUserId: userId,
          payload: {
            message,
          },
        });

        io.to(`event:${eventId}`).emit("event:message:new", {
          eventId,
          message: created,
        });

        callback?.({ ok: true, data: created });
      } catch (error) {
        callback?.({
          ok: false,
          message: error instanceof Error ? error.message : "Could not send message",
        });
      }
    });

    socket.on("direct:join", async (payload, callback) => {
      try {
        const conversationId = normalizeText(payload?.conversationId);

        if (!conversationId) {
          callback?.({ ok: false, message: "conversationId is required" });
          return;
        }

        await ensureDirectConversationAccess({ conversationId, userId });
        socket.join(`direct:${conversationId}`);

        callback?.({ ok: true, conversationId });
      } catch (error) {
        callback?.({
          ok: false,
          message:
            error instanceof Error ? error.message : "Could not join conversation",
        });
      }
    });

    socket.on("direct:leave", (payload, callback) => {
      const conversationId = normalizeText(payload?.conversationId);

      if (!conversationId) {
        callback?.({ ok: false, message: "conversationId is required" });
        return;
      }

      socket.leave(`direct:${conversationId}`);
      callback?.({ ok: true, conversationId });
    });

    socket.on("direct:message:send", async (payload, callback) => {
      try {
        const conversationId = normalizeText(payload?.conversationId);
        const message = normalizeText(payload?.message);

        if (!conversationId || !message) {
          callback?.({
            ok: false,
            message: "conversationId and message are required",
          });
          return;
        }

        await ensureDirectConversationAccess({ conversationId, userId });

        const result = await sendDirectMessage({
          actorUserId: userId,
          conversationId,
          message,
        });

        io.to(`direct:${conversationId}`).emit("direct:message:new", {
          conversationId,
          message: result.message,
        });

        for (const participant of result.conversation?.participants || []) {
          const participantUserId = String(participant?._id || participant || "");

          if (!participantUserId) {
            continue;
          }

          io.to(`user:${participantUserId}`).emit("direct:message:new", {
            conversationId,
            message: result.message,
          });
        }

        callback?.({ ok: true, data: result.message });
      } catch (error) {
        callback?.({
          ok: false,
          message: error instanceof Error ? error.message : "Could not send message",
        });
      }
    });

    socket.on("ping", (callback) => {
      callback?.({ ok: true, timestamp: new Date().toISOString() });
    });
  });

  setSocketServer(io);
  return io;
};

module.exports = {
  initializeSocketServer,
};
