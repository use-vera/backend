const { Schema, model } = require("mongoose");

/**
 * What Vera may use for one person, their weekly budget, and today's message
 * count. Each switch maps to a row on "what vera can see"; turning one off
 * removes that signal from her picks straight away.
 */
const veraSettingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    enabled: { type: Boolean, default: true },
    sees: {
      location: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      ratings: { type: Boolean, default: true },
      following: { type: Boolean, default: true },
      /* Read on the phone only; the server never sees appointments. */
      calendar: { type: Boolean, default: false },
      budget: { type: Boolean, default: false },
      usualSpend: { type: Boolean, default: true },
    },
    weeklyBudgetNaira: { type: Number, default: null, min: 0 },
    /* Messages sent on `day` (a Lagos date, YYYY-MM-DD), for the free daily cap. */
    usage: {
      day: { type: String, default: "" },
      count: { type: Number, default: 0 },
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

module.exports = model("VeraSettings", veraSettingsSchema);
