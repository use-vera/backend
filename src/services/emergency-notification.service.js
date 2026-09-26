const env = require("../config/env");
const AppNotification = require("../models/notification.model");
const DeviceToken = require("../models/device-token.model");
const EventTicket = require("../models/event-ticket.model");
const EventVendor = require("../models/event-vendor.model");
const Vendor = require("../models/vendor.model");
const { sendExpoPushMessages, isExpoPushToken } = require("./notification.service");
const { emitEventEmergencyAlert } = require("../realtime/socket-broker");

// Expo's push API hard-caps a single request at 100 messages.
const EXPO_BATCH_SIZE = 100;

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Everyone standing at the event, not only everyone who bought a ticket.
 *
 * Vendors are on site with the crowd — often behind gas — and hold no
 * ticket, so a ticket-only sweep leaves the people nearest the risk with no
 * warning at all.
 */
const getCheckedInAttendeeUserIds = async (eventId) => {
  const [tickets, bookings] = await Promise.all([
    EventTicket.find({ eventId, status: "used" }).select("buyerUserId").lean(),
    EventVendor.find({ eventId, status: "confirmed" }).select("vendorId").lean(),
  ]);

  const vendors = bookings.length
    ? await Vendor.find({ _id: { $in: bookings.map((row) => row.vendorId) } })
        .select("ownerUserId")
        .lean()
    : [];

  return [
    ...new Set([
      ...tickets.map((ticket) => String(ticket.buyerUserId)),
      ...vendors.map((vendor) => String(vendor.ownerUserId)),
    ]),
  ];
};

/**
 * The Notification Service's mass-fanout path. Deliberately distinct from
 * notification.service.js's single-user `createNotification`, which would
 * be a real perf problem at "notify every checked-in attendee" scale (N
 * individual Expo requests + N individual notification writes). Instead:
 * one bulk in-app insert, push tokens batched into groups of 100, plus a
 * realtime broadcast for anyone with the app already open.
 */
const broadcastEmergencyAlert = async ({ event, emergency, title, message, data = {} }) => {
  const recipientUserIds = await getCheckedInAttendeeUserIds(event._id);

  if (!recipientUserIds.length) {
    emitEventEmergencyAlert({ eventId: event._id, emergency, message });
    return { recipientCount: 0, pushAttempted: 0, pushSent: 0 };
  }

  const notificationData = {
    target: "event-emergency",
    eventId: String(event._id),
    emergencyId: String(emergency._id),
    category: emergency.category,
    ...data,
  };

  await AppNotification.insertMany(
    recipientUserIds.map((userId) => ({
      userId,
      type: "emergency.alert",
      title,
      message,
      data: notificationData,
    })),
  );

  const tokens = await DeviceToken.find({ userId: { $in: recipientUserIds } }).lean();
  const validTokens = tokens.filter((token) => isExpoPushToken(token.pushToken));

  let pushAttempted = 0;
  let pushSent = 0;

  for (const batch of chunk(validTokens, EXPO_BATCH_SIZE)) {
    const messages = batch.map((token) => ({
      to: token.pushToken,
      title,
      body: message,
      sound: "default",
      data: notificationData,
    }));

    pushAttempted += messages.length;

    try {
      const tickets = await sendExpoPushMessages(messages);
      pushSent += tickets.filter((ticket) => ticket?.status === "ok").length;
    } catch (error) {
      if (env.nodeEnv !== "production") {
        console.warn("[EmergencyNotification] Push batch failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  emitEventEmergencyAlert({ eventId: event._id, emergency, message });

  return {
    recipientCount: recipientUserIds.length,
    pushAttempted,
    pushSent,
  };
};

module.exports = {
  broadcastEmergencyAlert,
  getCheckedInAttendeeUserIds,
};
