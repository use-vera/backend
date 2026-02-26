const ApiError = require("../utils/api-error");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Membership = require("../models/membership.model");
const EventChatMessage = require("../models/event-chat-message.model");
const DirectConversation = require("../models/direct-conversation.model");
const DirectMessage = require("../models/direct-message.model");
const { normalizeMessagePayload } = require("../utils/chat-content");
const { createNotification } = require("./notification.service");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const normalizeObjectIdLike = (value) => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object" && value._id) {
    return String(value._id).trim();
  }

  return String(value).trim();
};

const normalizeParticipantIds = (values) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeObjectIdLike(value))
      .filter((value) => objectIdRegex.test(value)),
  )].sort();

const readMapValue = (source, key) => {
  const normalizedKey = String(key || "").trim();

  if (!source || !normalizedKey) {
    return undefined;
  }

  if (source instanceof Map) {
    return source.get(normalizedKey);
  }

  if (typeof source.get === "function") {
    return source.get(normalizedKey);
  }

  if (typeof source === "object") {
    return source[normalizedKey];
  }

  return undefined;
};

const readNumericMapValue = (source, key, fallback = 0) => {
  const value = Number(readMapValue(source, key));
  return Number.isFinite(value) ? value : fallback;
};

const readDateMapValue = (source, key) => {
  const value = readMapValue(source, key);

  if (!value) {
    return null;
  }

  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? null : stamp;
};

const parseParticipantIdsFromDirectKey = (directKey) => {
  const parts = String(directKey || "")
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length !== 2 || !parts.every((item) => objectIdRegex.test(item))) {
    return [];
  }

  const unique = [...new Set(parts)].sort();
  return unique.length === 2 ? unique : [];
};

const areSameIdSets = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (String(left[index]) !== String(right[index])) {
      return false;
    }
  }

  return true;
};

const repairConversationParticipants = async (conversation) => {
  if (!conversation?._id) {
    return [];
  }

  const idsFromParticipants = normalizeParticipantIds(conversation.participants);
  const idsFromDirectKey = parseParticipantIdsFromDirectKey(conversation.directKey);
  const canonicalIds = idsFromDirectKey.length === 2
    ? idsFromDirectKey
    : idsFromParticipants;

  if (canonicalIds.length !== 2) {
    return idsFromParticipants;
  }

  const updates = {};

  if (!areSameIdSets(idsFromParticipants, canonicalIds)) {
    updates.participants = canonicalIds;
  }

  if (idsFromDirectKey.length !== 2) {
    updates.directKey = `${canonicalIds[0]}:${canonicalIds[1]}`;
  }

  if (Object.keys(updates).length) {
    await DirectConversation.updateOne(
      { _id: conversation._id },
      { $set: updates },
    );
  }

  return canonicalIds;
};

const hydrateConversationUsers = async (conversation) => {
  if (!conversation?._id) {
    return null;
  }

  const raw = typeof conversation.toObject === "function"
    ? conversation.toObject()
    : conversation;
  const participantIds = normalizeParticipantIds(raw.participants);
  const senderId = normalizeObjectIdLike(raw.lastMessageSenderUserId);
  const referencedUserIds = [...new Set([
    ...participantIds,
    senderId,
  ].filter((value) => objectIdRegex.test(value)))];

  const users = referencedUserIds.length
    ? await User.find({ _id: { $in: referencedUserIds } })
        .select("_id fullName email avatarUrl title")
        .lean()
    : [];
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return {
    ...raw,
    participants: participantIds.map((id) => userMap.get(id) || id),
    lastMessageSenderUserId: userMap.get(senderId) || null,
  };
};

const hydrateConversationById = async (conversationId) => {
  const rawConversation = await DirectConversation.findById(conversationId)
    .select("_id directKey participants createdByUserId lastMessageText lastMessageAt lastMessageSenderUserId unreadCountByUser lastReadAtByUser lastNudgeAtByUser lastNudgedCountByUser");

  if (!rawConversation) {
    return null;
  }

  await repairConversationParticipants(rawConversation);

  const refreshedConversation = await DirectConversation.findById(rawConversation._id)
    .select("_id directKey participants createdByUserId lastMessageText lastMessageAt lastMessageSenderUserId unreadCountByUser lastReadAtByUser lastNudgeAtByUser lastNudgedCountByUser createdAt updatedAt");

  if (!refreshedConversation) {
    return null;
  }

  return hydrateConversationUsers(refreshedConversation);
};

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
  const conversation = await DirectConversation.findById(conversationId)
    .select("_id directKey participants");

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const participantIds = await repairConversationParticipants(conversation);
  const isParticipant = participantIds.includes(String(actorUserId));

  if (!isParticipant) {
    throw new ApiError(403, "You cannot access this conversation");
  }

  if (withParticipants) {
    const hydrated = await hydrateConversationById(conversation._id);

    if (!hydrated) {
      throw new ApiError(404, "Conversation not found");
    }

    return hydrated;
  }

  return conversation;
};

const markDirectConversationRead = async ({
  actorUserId,
  conversationId,
  at = new Date(),
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: false,
  });
  const key = String(actorUserId);

  await DirectConversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        [`unreadCountByUser.${key}`]: 0,
        [`lastReadAtByUser.${key}`]: at,
        [`lastNudgeAtByUser.${key}`]: null,
        [`lastNudgedCountByUser.${key}`]: 0,
      },
    },
  );
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

const DIRECT_DELETED_TEXT = "This message was deleted";

const applyDirectMessagePopulate = (query) =>
  query
    .populate("senderUserId", "fullName email avatarUrl title")
    .populate({
      path: "replyToMessageId",
      select:
        "_id message messageType senderUserId isDeleted deletedAt createdAt",
      populate: {
        path: "senderUserId",
        select: "fullName email avatarUrl title",
      },
    })
    .populate({
      path: "forwardedFromMessageId",
      select:
        "_id message messageType senderUserId isDeleted deletedAt createdAt",
      populate: {
        path: "senderUserId",
        select: "fullName email avatarUrl title",
      },
    });

const toDirectPreviewText = (message) => {
  if (!message) {
    return "";
  }

  if (message.isDeleted) {
    return DIRECT_DELETED_TEXT;
  }

  if (message.messageType === "ticket") {
    return "Shared a ticket";
  }

  if (message.messageType === "event") {
    return "Shared an event";
  }

  return String(message.message || "").trim().slice(0, 320);
};

const resolveDirectTicketCard = async ({ ticketRef, actorUserId }) => {
  const trimmedRef = String(ticketRef || "").trim();

  if (!trimmedRef) {
    throw new ApiError(400, "ticketRef is required");
  }

  let ticket = null;

  if (objectIdRegex.test(trimmedRef)) {
    ticket = await EventTicket.findById(trimmedRef)
      .populate("eventId", "name startsAt address imageUrl status");
  }

  if (!ticket) {
    ticket = await EventTicket.findOne({
      $or: [{ ticketCode: trimmedRef }, { barcodeValue: trimmedRef }],
    }).populate("eventId", "name startsAt address imageUrl status");
  }

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  const actorId = String(actorUserId);
  const buyerId = String(ticket.buyerUserId || "");
  const organizerId = String(ticket.organizerUserId || "");

  if (actorId !== buyerId && actorId !== organizerId) {
    throw new ApiError(403, "You cannot share this ticket");
  }

  const event = ticket.eventId && typeof ticket.eventId === "object"
    ? ticket.eventId
    : null;

  return {
    ticketId: String(ticket._id),
    ticketCode: ticket.ticketCode || "",
    barcodeValue: ticket.barcodeValue || ticket.ticketCode || String(ticket._id),
    status: ticket.status || "pending",
    eventId: event?._id ? String(event._id) : "",
    eventName: event?.name || "Event ticket",
    startsAt: event?.startsAt || null,
    address: event?.address || "",
    imageUrl: event?.imageUrl || "",
  };
};

const resolveDirectEventCard = async ({ eventId }) => {
  const normalizedEventId = String(eventId || "").trim();

  if (!objectIdRegex.test(normalizedEventId)) {
    throw new ApiError(400, "Invalid event id");
  }

  const event = await Event.findById(normalizedEventId)
    .select("_id name startsAt address imageUrl status");

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  return {
    eventId: String(event._id),
    name: event.name,
    startsAt: event.startsAt,
    address: event.address || "",
    imageUrl: event.imageUrl || "",
    status: event.status || "published",
  };
};

const refreshDirectConversationLastMessage = async (conversationId) => {
  const latest = await DirectMessage.findOne({ conversationId })
    .sort({ createdAt: -1 })
    .select(
      "_id senderUserId message messageType isDeleted deletedAt createdAt",
    );

  if (!latest) {
    await DirectConversation.updateOne(
      { _id: conversationId },
      {
        $set: {
          lastMessageText: "",
          lastMessageAt: null,
          lastMessageSenderUserId: null,
        },
      },
    );
    return null;
  }

  const preview = toDirectPreviewText(latest);

  await DirectConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessageText: preview,
        lastMessageAt: latest.createdAt,
        lastMessageSenderUserId: latest.senderUserId,
      },
    },
  );

  return latest;
};

const resolveForwardedMessage = async ({
  conversationId,
  forwardedFromMessageId,
}) => {
  const forwardedId = String(forwardedFromMessageId || "").trim();

  if (!forwardedId) {
    return null;
  }

  const message = await DirectMessage.findOne({
    _id: forwardedId,
    conversationId,
  })
    .populate("senderUserId", "fullName email avatarUrl title")
    .select("_id message messageType senderUserId isDeleted deletedAt");

  if (!message) {
    throw new ApiError(404, "Forward source message not found");
  }

  return {
    _id: String(message._id),
    message: message.isDeleted ? DIRECT_DELETED_TEXT : message.message || "",
    messageType: message.messageType || "text",
    sender:
      typeof message.senderUserId === "object" && message.senderUserId
        ? {
            _id: String(message.senderUserId._id),
            fullName: message.senderUserId.fullName || "Vera user",
          }
        : null,
    isDeleted: message.isDeleted === true,
  };
};

const resolveReplyMessage = async ({ conversationId, replyToMessageId }) => {
  const replyId = String(replyToMessageId || "").trim();

  if (!replyId) {
    return null;
  }

  const message = await DirectMessage.findOne({
    _id: replyId,
    conversationId,
  })
    .populate("senderUserId", "fullName email avatarUrl title")
    .select("_id message messageType senderUserId isDeleted deletedAt");

  if (!message) {
    throw new ApiError(404, "Reply target message not found");
  }

  return {
    _id: String(message._id),
    message: message.isDeleted ? DIRECT_DELETED_TEXT : message.message || "",
    messageType: message.messageType || "text",
    sender:
      typeof message.senderUserId === "object" && message.senderUserId
        ? {
            _id: String(message.senderUserId._id),
            fullName: message.senderUserId.fullName || "Vera user",
          }
        : null,
    isDeleted: message.isDeleted === true,
  };
};

const buildDirectMessageWrite = async ({
  actorUserId,
  conversationId,
  payload,
}) => {
  const normalized = normalizeMessagePayload({
    payload,
    allowEventCard: true,
  });
  const metadata = normalized.metadata || {};

  if (normalized.messageType === "ticket") {
    metadata.ticket = await resolveDirectTicketCard({
      ticketRef: metadata.ticketRef,
      actorUserId,
    });
  }

  if (normalized.messageType === "event") {
    metadata.event = await resolveDirectEventCard({
      eventId: metadata.eventId,
    });
  }

  const replyPreview = await resolveReplyMessage({
    conversationId,
    replyToMessageId: normalized.replyToMessageId,
  });

  if (replyPreview) {
    metadata.replyPreview = replyPreview;
  } else {
    delete metadata.replyPreview;
  }

  const forwardedPreview = await resolveForwardedMessage({
    conversationId,
    forwardedFromMessageId: normalized.forwardedFromMessageId,
  });

  if (forwardedPreview) {
    metadata.forwardedPreview = forwardedPreview;
  } else {
    delete metadata.forwardedPreview;
  }

  return {
    message: normalized.message,
    messageType: normalized.messageType,
    metadata,
    replyToMessageId: normalized.replyToMessageId || null,
    forwardedFromMessageId: normalized.forwardedFromMessageId || null,
  };
};

const hydrateDirectMessageById = async (messageId) => {
  const message = await applyDirectMessagePopulate(
    DirectMessage.findById(messageId),
  );

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  return message;
};

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
    .select("_id");

  if (!conversation) {
    try {
      conversation = await DirectConversation.findOneAndUpdate(
        { directKey },
        {
          $setOnInsert: {
            directKey,
            participants: [actorUserId, recipientUserId],
            createdByUserId: actorUserId,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      ).select("_id");
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      conversation = await DirectConversation.findOne({ directKey })
        .select("_id");
    }
  }

  if (!conversation) {
    throw new ApiError(500, "Could not start direct conversation");
  }

  const hydratedConversation = await hydrateConversationById(conversation._id);

  if (!hydratedConversation) {
    throw new ApiError(404, "Conversation not found");
  }

  return hydratedConversation;
};

const listDirectMessages = async ({
  actorUserId,
  conversationId,
  page = 1,
  limit = 30,
}) => {
  await markDirectConversationRead({
    actorUserId,
    conversationId,
  });

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
    applyDirectMessagePopulate(
      DirectMessage.find({ conversationId: conversation._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
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
  payload,
  message,
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: true,
  });

  const messageInput = await buildDirectMessageWrite({
    actorUserId,
    conversationId: conversation._id,
    payload:
      payload && typeof payload === "object"
        ? payload
        : {
            message,
          },
  });

  const created = await DirectMessage.create({
    conversationId: conversation._id,
    senderUserId: actorUserId,
    message: messageInput.message,
    messageType: messageInput.messageType,
    metadata: messageInput.metadata,
    replyToMessageId: messageInput.replyToMessageId,
    forwardedFromMessageId: messageInput.forwardedFromMessageId,
  });

  const hydratedMessage = await hydrateDirectMessageById(created._id);

  const stateConversation = await DirectConversation.findById(conversation._id)
    .select("_id participants unreadCountByUser");

  if (!stateConversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const participantIds = normalizeParticipantIds(stateConversation.participants);
  const senderId = String(actorUserId);
  const updateSet = {
    lastMessageText: toDirectPreviewText(hydratedMessage),
    lastMessageAt: hydratedMessage.createdAt,
    lastMessageSenderUserId: actorUserId,
  };

  for (const participantId of participantIds) {
    if (participantId === senderId) {
      updateSet[`unreadCountByUser.${participantId}`] = 0;
      updateSet[`lastReadAtByUser.${participantId}`] = hydratedMessage.createdAt;
      updateSet[`lastNudgeAtByUser.${participantId}`] = null;
      updateSet[`lastNudgedCountByUser.${participantId}`] = 0;
      continue;
    }

    const previousUnread = readNumericMapValue(
      stateConversation.unreadCountByUser,
      participantId,
      0,
    );
    updateSet[`unreadCountByUser.${participantId}`] = previousUnread + 1;
    updateSet[`lastNudgeAtByUser.${participantId}`] = null;
    updateSet[`lastNudgedCountByUser.${participantId}`] = 0;
  }

  await DirectConversation.updateOne(
    { _id: conversation._id },
    {
      $set: updateSet,
    },
  );

  const refreshedConversation = await DirectConversation.findById(conversation._id)
    .select("_id directKey participants createdByUserId lastMessageText lastMessageAt lastMessageSenderUserId unreadCountByUser lastReadAtByUser lastNudgeAtByUser lastNudgedCountByUser createdAt updatedAt");

  if (!refreshedConversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const hydratedConversation = await hydrateConversationUsers(refreshedConversation);

  if (!hydratedConversation) {
    throw new ApiError(404, "Conversation not found");
  }

  return {
    conversation: hydratedConversation,
    message: hydratedMessage,
  };
};

const updateDirectMessage = async ({
  actorUserId,
  conversationId,
  messageId,
  payload,
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: true,
  });
  const existing = await DirectMessage.findOne({
    _id: messageId,
    conversationId: conversation._id,
  }).select("_id senderUserId messageType isDeleted");

  if (!existing) {
    throw new ApiError(404, "Message not found");
  }

  if (String(existing.senderUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only edit your own message");
  }

  if (existing.isDeleted) {
    throw new ApiError(400, "Deleted messages cannot be edited");
  }

  if (existing.messageType !== "text") {
    throw new ApiError(400, "Only text messages can be edited");
  }

  const normalized = normalizeMessagePayload({
    payload: {
      ...(payload || {}),
      messageType: "text",
    },
    allowEventCard: true,
  });

  await DirectMessage.updateOne(
    { _id: existing._id },
    {
      $set: {
        message: normalized.message,
        editedAt: new Date(),
      },
    },
  );

  await refreshDirectConversationLastMessage(conversation._id);
  const hydratedMessage = await hydrateDirectMessageById(existing._id);

  return {
    conversation,
    message: hydratedMessage,
  };
};

const deleteDirectMessage = async ({
  actorUserId,
  conversationId,
  messageId,
}) => {
  const conversation = await ensureConversationParticipant({
    conversationId,
    actorUserId,
    withParticipants: true,
  });
  const existing = await DirectMessage.findOne({
    _id: messageId,
    conversationId: conversation._id,
  }).select("_id senderUserId isDeleted");

  if (!existing) {
    throw new ApiError(404, "Message not found");
  }

  if (String(existing.senderUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only unsend your own message");
  }

  if (!existing.isDeleted) {
    await DirectMessage.updateOne(
      { _id: existing._id },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          editedAt: new Date(),
          message: DIRECT_DELETED_TEXT,
          metadata: {},
          replyToMessageId: null,
          forwardedFromMessageId: null,
        },
      },
    );
  }

  await refreshDirectConversationLastMessage(conversation._id);
  const hydratedMessage = await hydrateDirectMessageById(existing._id);

  return {
    conversation,
    message: hydratedMessage,
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
  const directConversationRows = await DirectConversation.find({
    participants: actorUserId,
  })
    .select("_id participants lastMessageText lastMessageAt lastMessageSenderUserId unreadCountByUser updatedAt")
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(400)
    .lean();

  const referencedUserIds = new Set();

  for (const row of directConversationRows) {
    const participantIds = normalizeParticipantIds(row.participants);
    const otherId = participantIds.find((value) => value !== String(actorUserId));

    if (otherId) {
      referencedUserIds.add(otherId);
    }

    const senderId = normalizeObjectIdLike(row.lastMessageSenderUserId);

    if (objectIdRegex.test(senderId)) {
      referencedUserIds.add(senderId);
    }
  }

  const directUsers = referencedUserIds.size
    ? await User.find({ _id: { $in: [...referencedUserIds] } })
        .select("_id fullName email avatarUrl title")
        .lean()
    : [];
  const directUserMap = new Map(directUsers.map((user) => [String(user._id), user]));
  const directConversationsRaw = directConversationRows.map((conversation) => {
    const participantIds = normalizeParticipantIds(conversation.participants);
    const participantUsers = participantIds.map((id) => directUserMap.get(id) || id);
    const otherParticipantId = participantIds.find((value) => value !== String(actorUserId)) || "";
    const otherParticipant = directUserMap.get(otherParticipantId) || null;
    const senderId = normalizeObjectIdLike(conversation.lastMessageSenderUserId);
    const lastMessageSender = directUserMap.get(senderId) || senderId;

    return {
      ...conversation,
      participants: participantUsers,
      otherParticipant,
      lastMessageSenderUser: lastMessageSender,
      unreadCount: readNumericMapValue(
        conversation.unreadCountByUser,
        String(actorUserId),
      ),
    };
  });

  const directConversations = trimmedSearch
    ? directConversationsRaw.filter((conversation) => {
        const pattern = new RegExp(escapeRegex(trimmedSearch), "i");
        const other = conversation.otherParticipant;

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
    const otherParticipant = conversation.otherParticipant;

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
      lastMessageSender: toUserPreview(conversation.lastMessageSenderUser),
      unreadCount: Math.max(0, Number(conversation.unreadCount || 0)),
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

const getChatUnreadSummary = async ({ actorUserId }) => {
  const rows = await DirectConversation.find({
    participants: actorUserId,
  })
    .select("_id unreadCountByUser")
    .limit(5000)
    .lean();

  let unreadDirectMessages = 0;
  let unreadConversations = 0;

  for (const row of rows) {
    const count = Math.max(
      0,
      readNumericMapValue(row.unreadCountByUser, String(actorUserId), 0),
    );

    if (!count) {
      continue;
    }

    unreadConversations += 1;
    unreadDirectMessages += count;
  }

  return {
    unreadDirectMessages,
    unreadConversations,
  };
};

const sendPendingDirectMessageNudges = async ({
  delayMinutes = 120,
  maxConversations = 2000,
} = {}) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(1, Number(delayMinutes)) * 60 * 1000);

  const rows = await DirectConversation.find({
    lastMessageAt: { $ne: null, $lte: cutoff },
    lastMessageSenderUserId: { $ne: null },
  })
    .select(
      "_id participants lastMessageAt lastMessageSenderUserId unreadCountByUser lastReadAtByUser lastNudgeAtByUser lastNudgedCountByUser",
    )
    .sort({ lastMessageAt: -1 })
    .limit(Math.max(1, Number(maxConversations) || 2000))
    .lean();

  if (!rows.length) {
    return {
      checked: 0,
      sent: 0,
    };
  }

  const senderIds = [...new Set(
    rows
      .map((row) => normalizeObjectIdLike(row.lastMessageSenderUserId))
      .filter((value) => objectIdRegex.test(value)),
  )];
  const senderRows = senderIds.length
    ? await User.find({ _id: { $in: senderIds } })
        .select("_id fullName")
        .lean()
    : [];
  const senderNameMap = new Map(
    senderRows.map((row) => [String(row._id), row.fullName || "Someone"]),
  );

  let sent = 0;

  for (const row of rows) {
    const senderId = normalizeObjectIdLike(row.lastMessageSenderUserId);

    if (!objectIdRegex.test(senderId)) {
      continue;
    }

    const participantIds = normalizeParticipantIds(row.participants);

    if (participantIds.length !== 2) {
      continue;
    }

    const senderName = senderNameMap.get(senderId) || "Someone";
    const lastMessageAt = row.lastMessageAt ? new Date(row.lastMessageAt) : null;

    if (!lastMessageAt || Number.isNaN(lastMessageAt.getTime())) {
      continue;
    }

    for (const recipientId of participantIds) {
      if (recipientId === senderId) {
        continue;
      }

      const unreadCount = Math.max(
        0,
        readNumericMapValue(row.unreadCountByUser, recipientId, 0),
      );

      if (!unreadCount) {
        continue;
      }

      const lastReadAt = readDateMapValue(row.lastReadAtByUser, recipientId);

      if (lastReadAt && lastReadAt.getTime() >= lastMessageAt.getTime()) {
        continue;
      }

      const lastNudgeAt = readDateMapValue(row.lastNudgeAtByUser, recipientId);
      const lastNudgedCount = readNumericMapValue(
        row.lastNudgedCountByUser,
        recipientId,
        0,
      );

      if (
        lastNudgeAt &&
        lastNudgeAt.getTime() >= lastMessageAt.getTime() &&
        lastNudgedCount === unreadCount
      ) {
        continue;
      }

      try {
        await createNotification({
          userId: recipientId,
          type: "chat.direct.summary",
          title: `${senderName} sent ${unreadCount} message${unreadCount > 1 ? "s" : ""}`,
          message: "Open chat to catch up and reply.",
          data: {
            target: "direct-chat",
            conversationId: String(row._id),
            senderUserId: senderId,
            unreadCount,
          },
          push: true,
        });
      } catch (_error) {
        continue;
      }

      await DirectConversation.updateOne(
        { _id: row._id },
        {
          $set: {
            [`lastNudgeAtByUser.${recipientId}`]: now,
            [`lastNudgedCountByUser.${recipientId}`]: unreadCount,
          },
        },
      );

      sent += 1;
    }
  }

  return {
    checked: rows.length,
    sent,
  };
};

module.exports = {
  createOrGetDirectConversation,
  listDirectMessages,
  sendDirectMessage,
  updateDirectMessage,
  deleteDirectMessage,
  listChatThreads,
  discoverChatUsers,
  markDirectConversationRead,
  getChatUnreadSummary,
  sendPendingDirectMessageNudges,
};
