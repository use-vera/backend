const { Schema, model } = require("mongoose");

const ticketResaleBidSchema = new Schema(
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
    sellerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    bidderUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amountNaira: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ["open", "accepted", "rejected", "expired", "paid", "withdrawn"],
      default: "open",
      index: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    paidAt: {
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

ticketResaleBidSchema.index(
  {
    ticketId: 1,
    bidderUserId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: "open",
    },
  },
);

ticketResaleBidSchema.index({ sellerUserId: 1, createdAt: -1 });
ticketResaleBidSchema.index({ eventId: 1, status: 1, createdAt: -1 });

const TicketResaleBid = model("TicketResaleBid", ticketResaleBidSchema);

module.exports = TicketResaleBid;
