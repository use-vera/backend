const ApiError = require("./api-error");

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const explicitPatterns = [
  /\b(fuck|fucking|motherfucker|shit|bitch|asshole|dick|pussy|cunt|porn|nude|nudes|sex|xxx|blowjob|handjob|cum|rape)\b/i,
  /\bnigg(a|er)\b/i,
];

const normalizeText = (value) => String(value || "").trim();

const containsExplicitContent = (value) => {
  const text = normalizeText(value);

  if (!text) {
    return false;
  }

  const canonical = text.replace(/[_\-]+/g, " ");
  return explicitPatterns.some((pattern) => pattern.test(canonical));
};

const parseMessageShorthand = (message) => {
  const text = normalizeText(message);

  if (!text) {
    return null;
  }

  const ticketMatch =
    /^\/ticket\s+(.+)$/i.exec(text) || /^ticket:\s*(.+)$/i.exec(text);

  if (ticketMatch?.[1]) {
    return {
      messageType: "ticket",
      metadata: { ticketRef: normalizeText(ticketMatch[1]) },
      message: "Shared a ticket",
    };
  }

  const eventMatch =
    /^\/event\s+([a-fA-F0-9]{24})$/i.exec(text) ||
    /^event:\s*([a-fA-F0-9]{24})$/i.exec(text);

  if (eventMatch?.[1]) {
    return {
      messageType: "event",
      metadata: { eventId: normalizeText(eventMatch[1]) },
      message: "Shared an event",
    };
  }

  return null;
};

const normalizeMessagePayload = ({
  payload = {},
  allowEventCard = true,
}) => {
  const message = normalizeText(payload?.message);
  const shorthand = !payload?.messageType ? parseMessageShorthand(message) : null;
  const messageType = normalizeText(
    payload?.messageType || shorthand?.messageType || "text",
  ).toLowerCase();
  const metadata =
    payload?.metadata && typeof payload.metadata === "object"
      ? { ...payload.metadata }
      : {};
  const mergedMetadata = {
    ...metadata,
    ...(shorthand?.metadata || {}),
  };
  const normalized = {
    message: normalizeText(shorthand?.message || message),
    messageType,
    metadata: mergedMetadata,
    replyToMessageId: normalizeText(payload?.replyToMessageId),
    forwardedFromMessageId: normalizeText(payload?.forwardedFromMessageId),
  };

  if (!["text", "ticket", "event"].includes(messageType)) {
    throw new ApiError(400, "Unsupported message type");
  }

  if (!allowEventCard && messageType === "event") {
    throw new ApiError(400, "Event cards are not allowed in this chat");
  }

  if (normalized.replyToMessageId && !objectIdRegex.test(normalized.replyToMessageId)) {
    throw new ApiError(400, "Invalid reply target");
  }

  if (
    normalized.forwardedFromMessageId &&
    !objectIdRegex.test(normalized.forwardedFromMessageId)
  ) {
    throw new ApiError(400, "Invalid forward target");
  }

  if (messageType === "text") {
    if (!normalized.message) {
      throw new ApiError(400, "Message cannot be empty");
    }

    if (normalized.message.length > 1200) {
      throw new ApiError(400, "Message is too long");
    }
  }

  if (messageType === "ticket") {
    const ticketRef = normalizeText(mergedMetadata.ticketRef || normalized.message);

    if (!ticketRef) {
      throw new ApiError(400, "ticketRef is required for ticket messages");
    }

    if (ticketRef.length > 220) {
      throw new ApiError(400, "ticketRef is too long");
    }

    normalized.metadata.ticketRef = ticketRef;

    if (!normalized.message) {
      normalized.message = "Shared a ticket";
    }
  }

  if (messageType === "event") {
    const eventId = normalizeText(mergedMetadata.eventId || normalized.message);

    if (!objectIdRegex.test(eventId)) {
      throw new ApiError(400, "eventId is required for event messages");
    }

    normalized.metadata.eventId = eventId;

    if (!normalized.message) {
      normalized.message = "Shared an event";
    }
  }

  if (containsExplicitContent(normalized.message)) {
    throw new ApiError(400, "Explicit content is not allowed in chat");
  }

  return normalized;
};

module.exports = {
  objectIdRegex,
  containsExplicitContent,
  normalizeMessagePayload,
};
