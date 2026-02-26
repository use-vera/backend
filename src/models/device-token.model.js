const { Schema, model } = require("mongoose");

const deviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pushToken: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "unknown"],
      default: "unknown",
    },
    deviceId: {
      type: String,
      trim: true,
      default: "",
    },
    appVersion: {
      type: String,
      trim: true,
      default: "",
    },
    lastRegisteredAt: {
      type: Date,
      default: Date.now,
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

deviceTokenSchema.index({ userId: 1, updatedAt: -1 });

const DeviceToken = model("DeviceToken", deviceTokenSchema);

module.exports = DeviceToken;
