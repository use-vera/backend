const { Schema, model } = require("mongoose");

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: "",
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 280,
      default: "",
    },
    lastLoginAt: {
      type: Date,
    },
    preferences: {
      trackOnlyActiveHours: {
        type: Boolean,
        default: true,
      },
      activeHoursStart: {
        type: Number,
        min: 0,
        max: 23,
        default: 8,
      },
      activeHoursEnd: {
        type: Number,
        min: 0,
        max: 23,
        default: 18,
      },
      quietCheckIn: {
        type: Boolean,
        default: false,
      },
      weeklyDigest: {
        type: Boolean,
        default: true,
      },
      themePreference: {
        type: String,
        enum: ["system", "light", "dark"],
        default: "system",
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_, ret) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

const User = model("User", userSchema);

module.exports = User;
