const { Schema, model } = require("mongoose");

const verificationBadgeSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["organizer"],
      default: "organizer",
    },
    verified: {
      type: Boolean,
      default: false,
    },
    successfulEventsCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    threshold: {
      type: Number,
      min: 1,
      default: 5,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const organizerBrandingSchema = new Schema(
  {
    displayName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    tagline: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },
    logoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    bannerUrl: {
      type: String,
      trim: true,
      default: "",
    },
    primaryColor: {
      type: String,
      trim: true,
      maxlength: 24,
      default: "#5BDFB3",
    },
    accentColor: {
      type: String,
      trim: true,
      maxlength: 24,
      default: "#7C5CFF",
    },
    headerStyle: {
      type: String,
      enum: ["soft", "bold"],
      default: "soft",
    },
    ticketStyle: {
      type: String,
      enum: ["classic", "branded"],
      default: "classic",
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

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
    refreshTokenHash: {
      type: String,
      default: "",
      select: false,
    },
    refreshTokenIssuedAt: {
      type: Date,
      default: null,
      select: false,
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
    verificationBadge: {
      type: verificationBadgeSchema,
      default: () => ({
        kind: "organizer",
        verified: false,
        successfulEventsCount: 0,
        threshold: 5,
        verifiedAt: null,
      }),
    },
    subscriptionTier: {
      type: String,
      enum: ["free", "premium"],
      default: "free",
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "expired"],
      default: "inactive",
      index: true,
    },
    premiumActivatedAt: {
      type: Date,
      default: null,
    },
    premiumExpiresAt: {
      type: Date,
      default: null,
    },
    organizerBranding: {
      type: organizerBrandingSchema,
      default: () => ({
        displayName: "",
        tagline: "",
        logoUrl: "",
        bannerUrl: "",
        primaryColor: "#5BDFB3",
        accentColor: "#7C5CFF",
        headerStyle: "soft",
        ticketStyle: "classic",
        updatedAt: null,
      }),
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
