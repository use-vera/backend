const mongoose = require("mongoose");
const TicketTodo = require("../models/ticket-todo.model");
const { createNotification } = require("./notification.service");
const env = require("../config/env");

const TICK_MS = Math.max(
  60 * 1000,
  Number(env.ticketTodoReminderTickMs || 5 * 60 * 1000),
);

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

const runTicketTodoReminderTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    const now = new Date();

    const dueTodos = await TicketTodo.find({
      isCompleted: false,
      notifiedAt: null,
      remindAt: {
        $ne: null,
        $lte: now,
      },
    })
      .sort({ remindAt: 1 })
      .limit(250);

    for (const todo of dueTodos) {
      await createNotification({
        userId: todo.userId,
        type: "ticket.todo.reminder",
        title: "Ticket todo reminder",
        message: todo.title || "You have an event preparation task due.",
        data: {
          target: "ticket-todo",
          ticketId: String(todo.ticketId),
          eventId: String(todo.eventId),
          todoId: String(todo._id),
        },
        push: true,
      });

      await TicketTodo.updateOne(
        { _id: todo._id },
        {
          $set: {
            notifiedAt: now,
          },
        },
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[TicketTodoReminder] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startTicketTodoReminderMonitor = () => {
  if (!env.ticketTodoReminderEnabled) {
    // eslint-disable-next-line no-console
    console.log("[TicketTodoReminder] Disabled via TICKET_TODO_REMINDER_ENABLED=false");
    return;
  }

  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runTicketTodoReminderTick();
  }, TICK_MS);

  void runTicketTodoReminderTick();

  // eslint-disable-next-line no-console
  console.log(`[TicketTodoReminder] Started (tick=${TICK_MS}ms)`);
};

const stopTicketTodoReminderMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  startTicketTodoReminderMonitor,
  stopTicketTodoReminderMonitor,
  runTicketTodoReminderTick,
};
