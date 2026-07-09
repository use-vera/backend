const { Schema, model } = require("mongoose");

/**
 * A Developer Platform-facing wrapper around the existing ticket purchase
 * pipeline: one CheckoutSession maps to one initializeTicketPurchase batch
 * (the ticketIds it issued). No parallel inventory/payment logic lives here
 * — it just tracks the batch's lifecycle for API consumers polling/listing.
 */
const checkoutSessionSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    apiKeyId: {
      type: Schema.Types.ObjectId,
      ref: "ApiKey",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    buyerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    quantity: {
      type: Number,
      min: 1,
      max: 10,
      required: true,
    },
    ticketCategoryId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    ticketIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
    purchaseBatchId: {
      type: String,
      default: "",
    },
    paymentAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentAttempt",
      default: null,
    },
    status: {
      type: String,
      enum: ["reserved", "purchased", "expired", "cancelled"],
      default: "reserved",
      index: true,
    },
    requiresPayment: {
      type: Boolean,
      default: true,
    },
    // Raw Paystack authorizationUrl for this phase — there is no
    // Vera-hosted checkout page yet. Treat as an opaque redirect URL; a
    // future Developer Portal phase would point this at a real hosted
    // page instead without changing its meaning to integrators.
    checkoutUrl: {
      type: String,
      trim: true,
      default: "",
    },
    successUrl: {
      type: String,
      trim: true,
      default: "",
    },
    cancelUrl: {
      type: String,
      trim: true,
      default: "",
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // No default — must stay genuinely absent (not null) when unset, so the
    // sparse unique index below only enforces uniqueness among sessions
    // that actually supplied an Idempotency-Key. Mongo's sparse indexes
    // skip fields that are absent from the document, not fields present
    // with a null value, so a default:null here would defeat the index.
    clientIdempotencyKey: {
      type: String,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    purchasedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
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

checkoutSessionSchema.index({ status: 1, expiresAt: 1 });
checkoutSessionSchema.index({ workspaceId: 1, createdAt: -1 });
// A plain `sparse: true` doesn't work here: for a COMPOUND index, Mongo's
// sparse option only skips a document when ALL indexed fields are missing
// — since apiKeyId is always present, it would never actually skip
// anything. partialFilterExpression is the correct way to express
// "unique only among documents that supplied an Idempotency-Key".
checkoutSessionSchema.index(
  { apiKeyId: 1, clientIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { clientIdempotencyKey: { $exists: true } },
  },
);

const CheckoutSession = model("CheckoutSession", checkoutSessionSchema);

module.exports = CheckoutSession;
