const ApiError = require("../utils/api-error");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Membership = require("../models/membership.model");
const EventChatMessage = require("../models/event-chat-message.model");
const DirectConversation = require("../models/direct-conversation.model");
const DirectMessage = require("../models/direct-message.model");
const { createNotification } = require("./notification.service");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizePagination = ({ page = 1, limit = 20, maxLimit = 50 }) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(maxLimit, Math.max(1, Number(limit) || 20));

  return {
    pageNumber,
    limitNumber,
    skip: (pageNumber - 1) * limitNumber,
  };
};

const makeDirectKey = (leftId, rightId) => {
  const values = [String(leftId || "").trim(), String(rightId || "").trim()]
    .filter(Boolean)
    .sort();

  if (values.length !== 2 || values[0] === values[1]) {
    throw new ApiError(400, "Direct chat requires two different users");
  }

  return `${values[0]}:${values[1]}`;
};

const toUserPreview = (user) => {
  if (!user) {
    return null;
  }

  if (typeof user === "string") {
    return {
      _id: user,
      fullName: "Vera user",
      email: "",
      avatarUrl: "",
      title: "",
    };
  }

  return {
    _id: String(user._id),
    fullName: user.fullName || "Vera user",
    email: user.email || "",
    avatarUrl: user.avatarUrl || "",
    title: user.title || "",
  };
};

const ensureUserExists = async (userId) => {
  const user = await User.findById(userId).select("_id");

  if (!user) {
    throw new ApiError(404, "User not found");
  }
};

const ensureConversationParticipant = async ({
  conversationId,
  actorUserId,
  withParticipants = false,
}) => {
  const query = DirectConversation.findById(conversationId);

  if (withParticipants) {
    query.populate("participants", "fullName email avatarUrl title");
    query.populate("lastMessageSenderUserId", "fullName email avatarUrl title");
  }

  const conversation = await query;

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const isParticipant = conversation.participants
    .map((item) => String(item._id || item))
    .includes(String(actorUserId));

  if (!isParticipant) {
    throw new ApiError(403, "You cannot access this conversation");
  }

  return conversation;
};

const getEventIdsForUser = async ({ actorUserId }) => {
  const [hostedRows, ticketRows] = await Promise.all([
    Event.find({ organizerUserId: actorUserId })
      .select("_id")
      .limit(5000)
      .lean(),
    EventTicket.find({
      buyerUserId: actorUserId,
      status: { $in: ["pending", "paid", "used"] },
    })
      .select("eventId")
      .limit(5000)
      .lean(),
  ]);

  return [
    ...new Set(
      [
        ...hostedRows.map((row) => String(row._id)),
        ...ticketRows.map((row) => String(row.eventId)),
      ].filter((value) => objectIdRegex.test(value)),
    ),
  ];
};

const toObjectIds = (values) =>
  values
    .map((value) => String(value || "").trim())
    .filter((value) => objectIdRegex.test(value))
    .map((value) => new mongoose.Types.ObjectId(value));

const createOrGetDirectConversation = async ({
  actorUserId,
  recipientUserId,
}) => {
  if (!objectIdRegex.test(String(recipientUserId || ""))) {
    throw new ApiError(400, "Invalid recipient id");
  }

  if (String(actorUserId) === String(recipientUserId)) {
    throw new ApiError(400, "You cannot message yourself");
  }

  await Promise.all([ensureUserExists(actorUserId), ensureUserExists(recipientUserId)]);

  const directKey = makeDirectKey(actorUserId, recipientUserId);
  let conversation = await DirectConversation.findOne({ directKey })
    .populate("participants", "fullName email avatarUrl title")
    .populate("lastMessageSenderUserId", "fullName email avatarUrl title");

  if (!conversation) {
    conversation = await DirectConversation.create({
      directKey,
      participants: [actorUserId, recipientUserId],
      createdByUserId: actorUserId,
    });

    await conversation.populate("participants", "fullName email avatarUrl title");
    await conversation.populate("lastMessageSenderUserId", "fullName email avatarUrl title");
  }

  return conversation;
};

const listDirectMessages = async ({
  actorUserId,
  conversationId,
  page = 1,
  limit = 30,
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: true,
  });

  const { pageNumber, limitNumber, skip } = normalizePagination({
    page,
    limit,
    maxLimit: 80,
  });

  const [items, totalItems] = await Promise.all([
    DirectMessage.find({ conversationId: conversation._id })
      .populate("senderUserId", "fullName email avatarUrl title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    DirectMessage.countDocuments({ conversationId: conversation._id }),
  ]);

  return {
    conversation,
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const sendDirectMessage = async ({
  actorUserId,
  conversationId,
  message,
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: true,
  });

  const trimmedMessage = String(message || "").trim();

  if (!trimmedMessage) {
    throw new ApiError(400, "Message cannot be empty");
  }

  const created = await DirectMessage.create({
    conversationId: conversation._id,
    senderUserId: actorUserId,
    message: trimmedMessage,
  });

  await created.populate("senderUserId", "fullName email avatarUrl title");

  conversation.lastMessageText = trimmedMessage.slice(0, 320);
  conversation.lastMessageAt = created.createdAt;
  conversation.lastMessageSenderUserId = actorUserId;
  await conversation.save();
  await conversation.populate("lastMessageSenderUserId", "fullName email avatarUrl title");

  const recipient = conversation.participants.find(
    (participant) => String(participant._id || participant) !== String(actorUserId),
  );

  if (recipient?._id) {
    void createNotification({
      userId: recipient._id,
      type: "chat.direct.message",
      title: "New message",
      message: `${created.senderUserId?.fullName || "Someone"}: ${trimmedMessage.slice(0, 90)}`,
      data: {
        target: "direct-chat",
        conversationId: String(conversation._id),
      },
      push: true,
    }).catch(() => null);
  }

  return {
    conversation,
    message: created,
  };
};

const listChatThreads = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
}) => {
  const { pageNumber, limitNumber } = normalizePagination({
    page,
    limit,
    maxLimit: 60,
  });
  const trimmedSearch = String(search || "").trim();
  const directConversationsRaw = await DirectConversation.find({
    participants: actorUserId,
  })
    .populate("participants", "fullName email avatarUrl title")
    .populate("lastMessageSenderUserId", "fullName email avatarUrl title")
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(400)
    .lean();

  const directConversations = trimmedSearch
    ? directConversationsRaw.filter((conversation) => {
        const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
        const other = (conversation.participants || []).find(
          (participant) => String(participant._id) !== String(actorUserId),
        );

        return Boolean(
          other &&
            pattern.test(
              `${other.fullName || ""} ${other.email || ""} ${other.title || ""}`,
            ),
        );
      })
    : directConversationsRaw;

  const eventIds = await getEventIdsForUser({ actorUserId });
  const eventObjectIds = toObjectIds(eventIds);
  const eventQuery = { _id: { $in: eventObjectIds } };

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
    eventQuery.$or = [{ name: pattern }, { address: pattern }];
  }

  const [events, eventMessageRows] = await Promise.all([
    eventObjectIds.length
      ? Event.find(eventQuery)
          .populate("organizerUserId", "fullName email avatarUrl title")
          .select("name imageUrl startsAt address organizerUserId")
          .sort({ startsAt: 1, createdAt: -1 })
          .limit(250)
          .lean()
      : [],
    eventObjectIds.length
      ? EventChatMessage.aggregate([
          {
            $match: {
              eventId: {
                $in: eventObjectIds,
              },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: "$eventId",
              message: { $first: "$message" },
              createdAt: { $first: "$createdAt" },
              userId: { $first: "$userId" },
            },
          },
        ])
      : [],
  ]);

  const eventSenderIds = [...new Set(eventMessageRows.map((row) => String(row.userId)))];
  const eventSenders = eventSenderIds.length
    ? await User.find({ _id: { $in: eventSenderIds } })
        .select("_id fullName email avatarUrl title")
        .lean()
    : [];
  const senderMap = new Map(eventSenders.map((user) => [String(user._id), user]));
  const latestEventMessageMap = new Map(
    eventMessageRows.map((row) => [String(row._id), row]),
  );

  const directThreads = directConversations.map((conversation) => {
    const otherParticipant = (conversation.participants || []).find(
      (participant) => String(participant._id) !== String(actorUserId),
    );

    return {
      _id: `direct:${conversation._id}`,
      threadType: "direct",
      conversationId: String(conversation._id),
      title: otherParticipant?.fullName || "Direct chat",
      subtitle: otherParticipant?.title || "",
      avatarUrl: otherParticipant?.avatarUrl || "",
      participants: (conversation.participants || []).map(toUserPreview).filter(Boolean),
      event: null,
      lastMessageText: conversation.lastMessageText || "",
      lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
      lastMessageSender: toUserPreview(conversation.lastMessageSenderUserId),
      unreadCount: 0,
    };
  });

  const eventThreads = events.map((event) => {
    const latestMessage = latestEventMessageMap.get(String(event._id));
    const lastSender = latestMessage
      ? senderMap.get(String(latestMessage.userId))
      : null;

    return {
      _id: `event:${event._id}`,
      threadType: "event",
      conversationId: null,
      eventId: String(event._id),
      title: event.name,
      subtitle: event.address || "",
      avatarUrl: event.imageUrl || "",
      participants: [],
      event: {
        _id: String(event._id),
        name: event.name,
        imageUrl: event.imageUrl || "",
        startsAt: event.startsAt,
        address: event.address || "",
        organizerUserId: toUserPreview(event.organizerUserId),
      },
      lastMessageText: latestMessage?.message || "No messages yet",
      lastMessageAt: latestMessage?.createdAt || event.startsAt,
      lastMessageSender: toUserPreview(lastSender),
      unreadCount: 0,
    };
  });

  const merged = [...directThreads, ...eventThreads].sort((left, right) => {
    const leftTime = new Date(left.lastMessageAt || 0).getTime();
    const rightTime = new Date(right.lastMessageAt || 0).getTime();
    return rightTime - leftTime;
  });

  const totalItems = merged.length;
  const skip = (pageNumber - 1) * limitNumber;
  const items = merged.slice(skip, skip + limitNumber);

  return {
    items,
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

const discoverChatUsers = async ({
  actorUserId,
  page = 1,
  limit = 20,
  search,
}) => {
  const { pageNumber, limitNumber, skip } = normalizePagination({
    page,
    limit,
    maxLimit: 50,
  });
  const trimmedSearch = String(search || "").trim();
  const query = {
    _id: { $ne: actorUserId },
  };

  if (trimmedSearch) {
    const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
    query.$or = [{ fullName: pattern }, { email: pattern }, { title: pattern }];
  }

  const actorMemberships = await Membership.find({
    userId: actorUserId,
    status: "active",
  })
    .select("workspaceId")
    .limit(1200)
    .lean();

  const actorWorkspaceIds = actorMemberships.map((item) => item.workspaceId);

  const coworkerRows = actorWorkspaceIds.length
    ? await Membership.find({
        workspaceId: { $in: actorWorkspaceIds },
        status: "active",
      })
        .select("userId")
        .limit(5000)
        .lean()
    : [];

  const coworkerSet = new Set(
    coworkerRows
      .map((row) => String(row.userId))
      .filter((value) => value !== String(actorUserId)),
  );

  const [items, totalItems] = await Promise.all([
    User.find(query)
      .select("fullName email avatarUrl title")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      isCoworker: coworkerSet.has(String(item._id)),
    })),
    ...buildPaginationMeta({
      page: pageNumber,
      limit: limitNumber,
      totalItems,
    }),
  };
};

module.exports = {
  createOrGetDirectConversation,
  listDirectMessages,
  sendDirectMessage,
  listChatThreads,
  discoverChatUsers,
};
