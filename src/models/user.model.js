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
    /* Empty for accounts created by emailed sign-in code: they have no
       password. The web app's password sign-in still reads this. */
    passwordHash: {
      type: String,
      default: "",
      select: false,
    },
    /* The public @name. Lowercase, unique when present. Accounts that
       predate handles simply don't have one, hence sparse. */
    handle: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 24,
      default: undefined,
      unique: true,
      sparse: true,
    },
    /* Three states, on purpose:
         undefined - an account from before onboarding existed; never
                     sent through it.
         null      - created by sign-in code, onboarding not finished yet.
         a date    - finished.
       So no default here: a default would back-fill every old account as
       "not finished" the moment it is read. */
    onboardingCompletedAt: {
      type: Date,
    },
    termsAcceptedAt: {
      type: Date,
      default: null,
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
    /**
     * Only ever asked for where it decides something: verifying a vendor's
     * identity with their bank, and selling age-restricted items. Never
     * required to hold a plain ticket.
     */
    dateOfBirth: {
      type: Date,
      default: null,
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
    state: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
      index: true,
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
    /* Set when the person deletes their account: the profile is wiped at
       once, and purgedAt is set once everything else they made is erased. */
    deletedAt: { type: Date, default: null, index: true },
    purgedAt: { type: Date, default: null },
    /* A new sign-in email waiting on its emailed code. Only becomes the
       email once that code is entered. */
    pendingEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
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
      shareActivityWithFollowers: {
        type: Boolean,
        default: true,
      },
      /* Opt-in to drops and early-access email/text. Off unless the person
         ticked the box. */
      marketingOptIn: {
        type: Boolean,
        default: false,
      },
      preferredCategoryIds: {
        type: [Schema.Types.ObjectId],
        ref: "Category",
        default: [],
      },
      /* Push switches, one per topic in constants/notification-topics.js.
         Everything defaults on; turning one off stops the push but keeps
         the notification in the inbox. */
      notifications: {
        reminders: { type: Boolean, default: true },
        resaleOffers: { type: Boolean, default: true },
        eventChat: { type: Boolean, default: true },
        followersAndMessages: { type: Boolean, default: true },
        watches: { type: Boolean, default: true },
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
    payoutTier: {
      type: String,
      enum: ["standard", "trusted", "enterprise"],
      default: "standard",
      index: true,
    },
    isPlatformAdmin: {
      type: Boolean,
      default: false,
      select: false,
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
