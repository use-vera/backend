/**
 * The kinds of push people can switch off, and which notification types
 * fall under each. Anything not listed here always pushes: changes to an
 * event you hold a ticket for, cancellations, refunds, payouts, purchases
 * and emergencies are things nobody should miss by accident.
 *
 * Switching a topic off only stops the push. The notification still lands
 * in the in-app inbox, so nothing is lost.
 */
const NOTIFICATION_TOPICS = {
  reminders: ["event.reminder", "ticket.todo.reminder"],
  resaleOffers: [
    "ticket.resale.bid_placed",
    "ticket.resale.bid_accepted",
    "ticket.resale.bid_rejected",
    "ticket.resale.offer_expired",
  ],
  eventChat: [
    "event.chat.message",
    "event.chat.mention",
    "event.post.created",
    "event.post.comment",
  ],
  followersAndMessages: ["user.followed", "chat.direct.message", "chat.direct.summary"],
  watches: ["event.waitlist.spot_open", "vera.watch.resale", "vera.watch.host"],
};

const TOPIC_KEYS = Object.keys(NOTIFICATION_TOPICS);

const TOPIC_BY_TYPE = new Map(
  Object.entries(NOTIFICATION_TOPICS).flatMap(([topic, types]) =>
    types.map((type) => [type, topic]),
  ),
);

/** The switchable topic a notification type belongs to, or null if it always pushes. */
const topicForType = (type) => TOPIC_BY_TYPE.get(String(type || "")) || null;

module.exports = { NOTIFICATION_TOPICS, TOPIC_KEYS, topicForType };
