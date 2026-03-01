const { Schema, model } = require("mongoose");

const ticketTodoSchema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 180,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 800,
      default: "",
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    remindAt: {
      type: Date,
      default: null,
      index: true,
    },
    isCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  },
);

ticketTodoSchema.index({ ticketId: 1, dueAt: 1 });
ticketTodoSchema.index({ userId: 1, isCompleted: 1, dueAt: 1 });

const TicketTodo = model("TicketTodo", ticketTodoSchema);

module.exports = TicketTodo;
