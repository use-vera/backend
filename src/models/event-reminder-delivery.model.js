const { Schema, model } = require("mongoose");

const eventReminderDeliverySchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "EventTicket",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    occurrenceStartsAt: {
      type: Date,
      required: true,
      index: true,
    },
    offsetMinutes: {
      type: Number,
      required: true,
    },
    sentAt: {
      type: Date,
      default: () => new Date(),
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

eventReminderDeliverySchema.index(
  {
    eventId: 1,
    ticketId: 1,
    userId: 1,
    occurrenceStartsAt: 1,
    offsetMinutes: 1,
  },
  { unique: true },
);

const EventReminderDelivery = model(
  "EventReminderDelivery",
  eventReminderDeliverySchema,
);

module.exports = EventReminderDelivery;
