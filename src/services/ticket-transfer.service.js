const crypto = require("crypto");
const { isBlockedEitherWay } = require("./account-security.service");
const ApiError = require("../utils/api-error");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const Event = require("../models/event.model");
const TicketTransfer = require("../models/ticket-transfer.model");
const User = require("../models/user.model");
const { buildTicketCode, buildTicketBarcodeValue } = require("./event.service");
const { createNotification } = require("./notification.service");
const { dispatchEmail } = require("./email.service");
const { ticketSent } = require("../emails/transfer.emails");

const DAY_MS = 24 * 60 * 60 * 1000;
/* A send is open for a week, or until the event ends if that comes first. */
const TRANSFER_LIFETIME_MS = 7 * DAY_MS;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toId = (value) => String(value?._id || value || "");
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const notify = (payload) => void createNotification({ push: true, ...payload }).catch(() => null);
const firstName = (name) => String(name || "Someone").trim().split(/\s+/)[0];

/** "@ada", "ada" or "ada@example.com" → who that is, if they're on Vera. */
const resolveRecipient = async (rawTo) => {
  const to = String(rawTo || "").trim();

  if (EMAIL_PATTERN.test(to)) {
    const email = to.toLowerCase();
    const user = await User.findOne({ email }).select("_id fullName email handle");
    return { user, email };
  }

  const handle = to.replace(/^@+/, "").toLowerCase();

  if (!handle) {
    throw new ApiError(400, "Enter an @handle or an email address");
  }

  const user = await User.findOne({ handle }).select("_id fullName email handle");

  if (!user) {
    throw new ApiError(404, `No one on Vera is @${handle}. You can send it to their email instead.`, null, "RECIPIENT_NOT_FOUND");
  }

  return { user, email: user.email };
};

const describeRecipient = (transfer, user) =>
  user ? { name: user.fullName || "", handle: user.handle || "", email: "" } : { name: "", handle: "", email: transfer.toEmail };

/** The sender's side: send a held ticket to someone. */
const createTicketTransfer = async ({ ticketId, actorUserId, payload }) => {
  const ticket = await EventTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }
  if (toId(ticket.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only send your own tickets");
  }
  if (ticket.status !== "paid" || ticket.usedAt) {
    throw new ApiError(409, "Only unused tickets can be sent", null, "TRANSFER_NOT_ALLOWED");
  }
  if (ticket.resaleStatus && ticket.resaleStatus !== "none") {
    throw new ApiError(409, "This ticket is up for resale. Take it down before sending it.", null, "TRANSFER_WHILE_LISTED");
  }

  const event = await Event.findById(ticket.eventId).select("name startsAt endsAt status");

  if (!event || event.status === "cancelled") {
    throw new ApiError(409, "This event was cancelled, so its tickets can't be sent", null, "TRANSFER_NOT_ALLOWED");
  }

  const now = new Date();
  if (event.endsAt && new Date(event.endsAt).getTime() <= now.getTime()) {
    throw new ApiError(409, "This event has ended", null, "TRANSFER_NOT_ALLOWED");
  }

  const { user: recipient, email } = await resolveRecipient(payload.to);

  if (recipient && toId(recipient) === String(actorUserId)) {
    throw new ApiError(400, "That's you. Send it to someone else.");
  }

  if (recipient && (await isBlockedEitherWay(actorUserId, recipient._id))) {
    throw new ApiError(404, "We couldn't send it to that person.", null, "RECIPIENT_NOT_FOUND");
  }

  const sender = await User.findById(actorUserId).select("fullName email");

  if (!recipient && email === String(sender?.email || "").toLowerCase()) {
    throw new ApiError(400, "That's you. Send it to someone else.");
  }

  /* Re-sending replaces the earlier send. */
  await TicketTransfer.updateMany(
    { ticketId: ticket._id, status: "pending" },
    { $set: { status: "cancelled", respondedAt: now } },
  );

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Math.min(now.getTime() + TRANSFER_LIFETIME_MS, new Date(event.endsAt || now.getTime() + TRANSFER_LIFETIME_MS).getTime()),
  );

  let transfer;
  try {
    transfer = await TicketTransfer.create({
      ticketId: ticket._id,
      eventId: event._id,
      fromUserId: actorUserId,
      toUserId: recipient?._id || null,
      toEmail: recipient ? "" : email,
      note: String(payload.note || "").trim().slice(0, 200),
      tokenHash: hashToken(token),
      expiresAt,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "This ticket is already being sent", null, "TRANSFER_PENDING");
    }
    throw error;
  }

  const quantity = Math.max(1, Number(ticket.quantity || 1));

  if (recipient) {
    notify({
      userId: recipient._id,
      type: "ticket.transfer.received",
      title: `${firstName(sender?.fullName)} sent you a ticket`,
      message: `${quantity > 1 ? `${quantity} tickets` : "A ticket"} to ${event.name}. Accept it to get your own code.`,
      data: { target: "ticket-transfer", transferId: String(transfer._id), eventId: String(event._id) },
    });
  }

  if (email) {
    void dispatchEmail({
      to: email,
      ...ticketSent({
        fromName: sender?.fullName,
        eventName: event.name,
        eventStartsAt: event.startsAt,
        tierName: ticket.ticketCategoryName || "Ticket",
        quantity,
        note: transfer.note,
        token,
        recipientEmail: email,
      }),
    });
  }

  return { ...transfer.toJSON(), recipient: describeRecipient(transfer, recipient) };
};

/** The sender changes their mind before it's accepted. */
const cancelTicketTransfer = async ({ ticketId, actorUserId }) => {
  const transfer = await TicketTransfer.findOneAndUpdate(
    { ticketId, fromUserId: actorUserId, status: "pending" },
    { $set: { status: "cancelled", respondedAt: new Date() } },
    { new: true },
  );

  if (!transfer) {
    throw new ApiError(404, "There's no send in progress for this ticket");
  }

  return transfer;
};

/** Whether this user is the one a transfer was sent to. */
const isRecipient = (transfer, user) =>
  (transfer.toUserId && toId(transfer.toUserId) === toId(user)) ||
  (transfer.toEmail && transfer.toEmail === String(user?.email || "").toLowerCase());

const presentTransfer = async (transfer, user) => {
  const [ticket, event, sender] = await Promise.all([
    EventTicket.findById(transfer.ticketId).select("quantity ticketCategoryName"),
    Event.findById(transfer.eventId).select("name startsAt endsAt imageUrl address"),
    User.findById(transfer.fromUserId).select("fullName handle avatarUrl"),
  ]);
  const expired = new Date(transfer.expiresAt).getTime() <= Date.now();

  return {
    _id: String(transfer._id),
    status: transfer.status === "pending" && expired ? "expired" : transfer.status,
    note: transfer.note,
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
    quantity: Math.max(1, Number(ticket?.quantity || 1)),
    tierName: ticket?.ticketCategoryName || "Ticket",
    from: { name: sender?.fullName || "", handle: sender?.handle || "", avatarUrl: sender?.avatarUrl || "" },
    event: event
      ? {
          _id: String(event._id),
          name: event.name,
          startsAt: event.startsAt,
          imageUrl: event.imageUrl || "",
          address: event.address || "",
        }
      : null,
    /* Shown so someone signed in with the wrong account knows why. */
    sentToEmail: transfer.toEmail || "",
    canAccept: transfer.status === "pending" && !expired && isRecipient(transfer, user),
  };
};

/** Tickets waiting for this user to accept. */
const listIncomingTransfers = async ({ actorUserId }) => {
  const user = await User.findById(actorUserId).select("_id email");
  const email = String(user?.email || "").toLowerCase();
  const transfers = await TicketTransfer.find({
    status: "pending",
    expiresAt: { $gt: new Date() },
    $or: [{ toUserId: actorUserId }, ...(email ? [{ toEmail: email }] : [])],
  }).sort({ createdAt: -1 });

  return { items: await Promise.all(transfers.map((transfer) => presentTransfer(transfer, user))) };
};

/** What the claim link points at, for the signed-in user opening it. */
const getTransferByToken = async ({ token, actorUserId }) => {
  const transfer = await TicketTransfer.findOne({ tokenHash: hashToken(token) });

  if (!transfer) {
    throw new ApiError(404, "This link isn't valid. Ask for the ticket to be sent again.", null, "TRANSFER_NOT_FOUND");
  }

  const user = await User.findById(actorUserId).select("_id email");
  return presentTransfer(transfer, user);
};

const getIncomingTransfer = async ({ transferId, actorUserId }) => {
  const transfer = await TicketTransfer.findById(transferId);
  const user = await User.findById(actorUserId).select("_id email");

  if (!transfer || !isRecipient(transfer, user)) {
    throw new ApiError(404, "Ticket send not found", null, "TRANSFER_NOT_FOUND");
  }

  return { transfer, user };
};

/**
 * The recipient accepts: the ticket and its add-ons become theirs, with a
 * fresh code so the sender's copy stops working.
 */
const acceptTicketTransfer = async ({ transferId, actorUserId }) => {
  const { transfer, user } = await getIncomingTransfer({ transferId, actorUserId });

  if (transfer.status !== "pending" || new Date(transfer.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(409, "This ticket send has expired or was cancelled", null, "TRANSFER_CLOSED");
  }

  /* Claimed first, so accepting twice cannot move the ticket twice. */
  const claimed = await TicketTransfer.findOneAndUpdate(
    { _id: transfer._id, status: "pending" },
    { $set: { status: "accepted", respondedAt: new Date(), toUserId: user._id } },
    { new: true },
  );

  if (!claimed) {
    throw new ApiError(409, "This ticket send has already been answered", null, "TRANSFER_CLOSED");
  }

  const recipient = await User.findById(actorUserId).select("fullName email");
  const ticket = await EventTicket.findById(transfer.ticketId);
  const stillSendable =
    ticket &&
    toId(ticket.buyerUserId) === toId(transfer.fromUserId) &&
    ticket.status === "paid" &&
    !ticket.usedAt &&
    (!ticket.resaleStatus || ticket.resaleStatus === "none");

  if (!stillSendable) {
    await TicketTransfer.updateOne({ _id: transfer._id }, { $set: { status: "cancelled" } });
    throw new ApiError(409, "This ticket can't be sent any more (it was used or changed)", null, "TRANSFER_CLOSED");
  }

  const ticketCode = await buildTicketCode();
  const moved = await EventTicket.findOneAndUpdate(
    { _id: ticket._id, buyerUserId: transfer.fromUserId, status: "paid", usedAt: null },
    {
      $set: {
        buyerUserId: recipient._id,
        attendeeName: String(recipient.fullName || "").trim(),
        attendeeEmail: String(recipient.email || "").trim().toLowerCase(),
        ticketCode,
        barcodeValue: buildTicketBarcodeValue({
          ticketCode,
          eventId: ticket.eventId,
          ticketCategoryId: ticket.ticketCategoryId,
        }),
        lastTransferredAt: new Date(),
        holderLastLatitude: null,
        holderLastLongitude: null,
        holderLocationUpdatedAt: null,
      },
    },
    { new: true },
  );

  if (!moved) {
    await TicketTransfer.updateOne({ _id: transfer._id }, { $set: { status: "cancelled" } });
    throw new ApiError(409, "This ticket can't be sent any more (it was used or changed)", null, "TRANSFER_CLOSED");
  }

  await EventAddOnPurchase.updateMany(
    { ticketId: ticket._id, status: { $in: ["paid", "redeemed"] } },
    { $set: { buyerUserId: recipient._id } },
  );

  notify({
    userId: transfer.fromUserId,
    type: "ticket.transfer.accepted",
    title: `${firstName(recipient.fullName)} accepted your ticket`,
    message: "It's theirs now, with its own code. Yours no longer works.",
    data: { target: "event-details", eventId: toId(transfer.eventId) },
  });

  return moved;
};

const declineTicketTransfer = async ({ transferId, actorUserId }) => {
  const { transfer } = await getIncomingTransfer({ transferId, actorUserId });

  const declined = await TicketTransfer.findOneAndUpdate(
    { _id: transfer._id, status: "pending" },
    { $set: { status: "declined", respondedAt: new Date() } },
    { new: true },
  );

  if (!declined) {
    throw new ApiError(409, "This ticket send has already been answered", null, "TRANSFER_CLOSED");
  }

  notify({
    userId: transfer.fromUserId,
    type: "ticket.transfer.declined",
    title: "Your ticket wasn't accepted",
    message: "It's still yours, and its code still works.",
    data: { target: "ticket-details", ticketId: toId(transfer.ticketId), eventId: toId(transfer.eventId) },
  });

  return declined;
};

module.exports = {
  TRANSFER_LIFETIME_MS,
  createTicketTransfer,
  cancelTicketTransfer,
  listIncomingTransfers,
  getTransferByToken,
  acceptTicketTransfer,
  declineTicketTransfer,
};
