/**
 * The socket transport's view of a chat message.
 *
 * Extracted so it can be asserted directly. Both transports funnel into the
 * same service, but each hand-builds the object it passes, and a field added
 * to one is silently dropped by the other — the message still sends, the
 * mention just never happens. That failure is invisible in the service tests,
 * so the mapping is tested rather than trusted.
 */
const buildEventChatSendPayload = (payload = {}) => ({
  message: String(payload.message || "").trim(),
  messageType: payload.messageType,
  metadata: payload.metadata,
  replyToMessageId: payload.replyToMessageId,
  forwardedFromMessageId: payload.forwardedFromMessageId,
  mentionedUserIds: Array.isArray(payload.mentionedUserIds)
    ? payload.mentionedUserIds
    : undefined,
});

module.exports = { buildEventChatSendPayload };
