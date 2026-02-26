const { Schema, model } = require("mongoose");

const normalizeOffsets = (offsets) => {
  if (!Array.isArray(offsets)) {
    return [1440, 180, 30];
  }

  const normalized = [...new Set(
    offsets
      .map((value) => Number(value))
      .filter(
        (value) =>
          Number.isInteger(value) && value >= 5 && value <= 14 * 24 * 60,
      ),
  )].sort((a, b) => b - a);

  if (!normalized.length) {
    return [1440, 180, 30];
  }

  return normalized;
};

const eventReminderPreferenceSchema = new Schema(
  {
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
    enabled: {
      type: Boolean,
      default: true,
    },
    offsetsMinutes: {
      type: [Number],
      default: [1440, 180, 30],
      set: normalizeOffsets,
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

eventReminderPreferenceSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true },
);

const EventReminderPreference = model(
  "EventReminderPreference",
  eventReminderPreferenceSchema,
);

module.exports = EventReminderPreference;
