const mongoose = require("mongoose");
const EventTicket = require("../models/event-ticket.model");
const EventReminderPreference = require("../models/event-reminder-preference.model");
const EventReminderDelivery = require("../models/event-reminder-delivery.model");
const { createNotification } = require("./notification.service");
const { resolveOccurrenceWindow } = require("./event.service");
const env = require("../config/env");

const DEFAULT_REMINDER_OFFSETS = [1440, 180, 30];
const TICK_MS = Math.max(60 * 1000, Number(env.eventReminderTickMs || 5 * 60 * 1000));
const LOOKAHEAD_MINUTES = 26 * 60;
const objectIdRegex = /^[a-fA-F0-9]{24}$/;

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const normalizeOffsets = (offsets) => {
  if (!Array.isArray(offsets)) {
    return DEFAULT_REMINDER_OFFSETS;
  }

  const normalized = [...new Set(
    offsets
      .map((value) => Number(value))
      .filter(
        (value) =>
          Number.isInteger(value) && value >= 5 && value <= 14 * 24 * 60,
      ),
  )].sort((a, b) => b - a);

  return normalized.length ? normalized : DEFAULT_REMINDER_OFFSETS;
};

const formatReminderWindow = (offsetMinutes) => {
  const minutes = Number(offsetMinutes || 0);

  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    const days = Math.round(minutes / (24 * 60));
    return `${days} day${days > 1 ? "s" : ""}`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }

  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
};

const isDuplicateKeyError = (error) =>
  Boolean(error && typeof error === "object" && Number(error.code) === 11000);

const runEventReminderTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const now = new Date();
    const tickets = await EventTicket.find({
      status: { $in: ["paid", "used"] },
      createdAt: {
        $gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      },
    })
      .populate(
        "eventId",
        "name status startsAt endsAt recurrence address timezone organizerUserId expectedTickets ticketPriceNaira isPaid pricing",
      )
      .sort({ createdAt: -1 })
      .limit(4000);

    if (!tickets.length) {
      return;
    }

    const eventIds = [
      ...new Set(
        tickets
          .map((ticket) => String(ticket.eventId?._id || ""))
          .filter((value) => objectIdRegex.test(value)),
      ),
    ];
    const userIds = [
      ...new Set(
        tickets
          .map((ticket) => String(ticket.buyerUserId || ""))
          .filter((value) => objectIdRegex.test(value)),
      ),
    ];

    const preferences = await EventReminderPreference.find({
      eventId: { $in: eventIds },
      userId: { $in: userIds },
    }).lean();

    const preferenceMap = new Map(
      preferences.map((item) => [
        `${String(item.eventId)}:${String(item.userId)}`,
        item,
      ]),
    );

    const dueWindowMinutes = Math.max(1, TICK_MS / 60000) + 1;

    for (const ticket of tickets) {
      const event = ticket.eventId;

      if (!event || typeof event !== "object" || event.status !== "published") {
        continue;
      }

      const occurrence = resolveOccurrenceWindow(event, now);

      if (!occurrence) {
        continue;
      }

      const minutesToStart =
        (new Date(occurrence.startsAt).getTime() - now.getTime()) / 60000;

      if (minutesToStart < -1 || minutesToStart > LOOKAHEAD_MINUTES) {
        continue;
      }

      const key = `${String(event._id)}:${String(ticket.buyerUserId)}`;
      const preference = preferenceMap.get(key);
      const enabled = preference ? preference.enabled !== false : true;

      if (!enabled) {
        continue;
      }

      const offsets = normalizeOffsets(preference?.offsetsMinutes);

      for (const offset of offsets) {
        if (
          minutesToStart > offset ||
          minutesToStart <= offset - dueWindowMinutes
        ) {
          continue;
        }

        try {
          await EventReminderDelivery.create({
            eventId: event._id,
            ticketId: ticket._id,
            userId: ticket.buyerUserId,
            occurrenceStartsAt: new Date(occurrence.startsAt),
            offsetMinutes: offset,
            sentAt: now,
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            continue;
          }

          throw error;
        }

        const startsAtText = new Date(occurrence.startsAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        await createNotification({
          userId: ticket.buyerUserId,
          type: "event.reminder",
          title: `${event.name} starts in ${formatReminderWindow(offset)}`,
          message: `Event starts at ${startsAtText}. Open Vera to check in when you arrive.`,
          data: {
            target: "event-reminder",
            eventId: String(event._id),
            ticketId: String(ticket._id),
            offsetMinutes: offset,
          },
          push: true,
        });
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[EventReminder] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startEventReminderMonitor = () => {
  if (!env.eventReminderEnabled) {
    // eslint-disable-next-line no-console
    console.log("[EventReminder] Disabled via EVENT_REMINDER_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runEventReminderTick();
  }, TICK_MS);

  void runEventReminderTick();

  // eslint-disable-next-line no-console
  console.log(`[EventReminder] Started (tick=${TICK_MS}ms)`);
};

const stopEventReminderMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startEventReminderMonitor,
  stopEventReminderMonitor,
  runEventReminderTick,
};
