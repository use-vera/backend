const ApiError = require("../utils/api-error");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const ResaleSale = require("../models/resale-sale.model");
const Vendor = require("../models/vendor.model");
const VendorOrder = require("../models/vendor-order.model");
const Follow = require("../models/follow.model");
const UserBlock = require("../models/user-block.model");
const SavedEvent = require("../models/saved-event.model");
const EventWaitlistEntry = require("../models/event-waitlist-entry.model");
const TicketTransfer = require("../models/ticket-transfer.model");
const DeviceToken = require("../models/device-token.model");
const UserSession = require("../models/user-session.model");
const Membership = require("../models/membership.model");
const EmailOtp = require("../models/email-otp.model");
const AppNotification = require("../models/notification.model");
const DirectMessage = require("../models/direct-message.model");
const EventPost = require("../models/event-post.model");
const EventPostComment = require("../models/event-post-comment.model");
const EventPostLike = require("../models/event-post-like.model");
const EventChatMessage = require("../models/event-chat-message.model");
const EventReminderPreference = require("../models/event-reminder-preference.model");
const TicketTodo = require("../models/ticket-todo.model");
const EventRating = require("../models/event-rating.model");
const AttendanceLog = require("../models/attendance-log.model");
const AttendanceSession = require("../models/attendance-session.model");
const EventView = require("../models/event-view.model");
const PayoutAccount = require("../models/payout-account.model");
const { revokeOtherSessions } = require("./session.service");

/* Lazy: auth.service pulls in workspaces and subscriptions. */
const authCodes = () => require("./auth.service");

/** What we promise on the screen: everything personal is gone within this. */
const ERASE_WITHIN_DAYS = 30;

const toIdString = (value) => String(value?._id || value || "");

/* ---------- What has to be settled first ---------- */

/**
 * Everything that has to be settled before an account can go: tickets that
 * would be lost, money that's still the person's, and events other people
 * hold tickets for. Each blocker says what to do about it.
 */
const listDeletionBlockers = async (userId) => {
  const now = new Date();
  const [
    paidTickets,
    pendingTickets,
    wallet,
    openWithdrawals,
    resaleOwed,
    hostedUpcoming,
    vendorIds,
    myOpenOrders,
  ] = await Promise.all([
    EventTicket.find({ buyerUserId: userId, status: "paid" }).select("eventId quantity").lean(),
    EventTicket.countDocuments({ buyerUserId: userId, status: "pending" }),
    OrganizerWallet.findOne({ organizerUserId: userId }).lean(),
    Withdrawal.countDocuments({ organizerUserId: userId, status: { $in: ["reserved", "processing"] } }),
    ResaleSale.find({ sellerUserId: userId, status: { $in: ["held", "awaiting_account", "processing", "failed"] } })
      .select("amountKobo releaseAt")
      .lean(),
    Event.countDocuments({ organizerUserId: userId, status: "published", endsAt: { $gte: now } }),
    Vendor.find({ ownerUserId: userId }).distinct("_id"),
    VendorOrder.countDocuments({ buyerUserId: userId, status: { $in: ["paid", "preparing", "ready"] } }),
  ]);

  const blockers = [];

  /* Paid tickets only count while the event is still to come. */
  const upcomingEventIds = paidTickets.length
    ? await Event.find({
        _id: { $in: paidTickets.map((ticket) => ticket.eventId) },
        status: "published",
        endsAt: { $gte: now },
      }).distinct("_id")
    : [];
  const upcoming = new Set(upcomingEventIds.map(String));
  const upcomingTickets = paidTickets
    .filter((ticket) => upcoming.has(toIdString(ticket.eventId)))
    .reduce((sum, ticket) => sum + Number(ticket.quantity || 1), 0);

  if (upcomingTickets > 0) {
    blockers.push({ code: "UPCOMING_TICKETS", count: upcomingTickets, message: "Resell or send them, or they're lost." });
  }

  if (pendingTickets > 0) {
    blockers.push({ code: "PURCHASE_IN_PROGRESS", count: pendingTickets, message: "Finish or cancel the checkout first." });
  }

  if (wallet?.availableBalanceKobo > 0) {
    blockers.push({ code: "WALLET_AVAILABLE", amountKobo: wallet.availableBalanceKobo, message: "Withdraw it first." });
  }

  if (wallet?.pendingBalanceKobo > 0) {
    const latest = await WalletTransaction.findOne({ organizerUserId: userId, status: "pending_settlement" })
      .sort({ settlementEligibleAt: -1 })
      .select("settlementEligibleAt")
      .lean();
    blockers.push({
      code: "WALLET_PENDING",
      amountKobo: wallet.pendingBalanceKobo,
      until: latest?.settlementEligibleAt || null,
      message: "You can delete after it lands.",
    });
  }

  if (openWithdrawals > 0 || wallet?.reservedBalanceKobo > 0) {
    blockers.push({ code: "WITHDRAWAL_IN_PROGRESS", count: openWithdrawals, message: "Wait for your withdrawal to reach your bank." });
  }

  if (wallet?.owingBalanceKobo > 0) {
    blockers.push({ code: "WALLET_OWING", amountKobo: wallet.owingBalanceKobo, message: "Settle what's owed from a refund or chargeback first." });
  }

  if (resaleOwed.length > 0) {
    blockers.push({
      code: "RESALE_PAYOUTS",
      amountKobo: resaleOwed.reduce((sum, sale) => sum + sale.amountKobo, 0),
      until: resaleOwed.reduce((latest, sale) => (!latest || sale.releaseAt > latest ? sale.releaseAt : latest), null),
      message: "Money from tickets you resold is still on its way to you.",
    });
  }

  if (hostedUpcoming > 0) {
    blockers.push({ code: "HOSTING", count: hostedUpcoming, message: "Cancel them or let them finish first." });
  }

  const vendorOpenOrders = vendorIds.length
    ? await VendorOrder.countDocuments({ vendorId: { $in: vendorIds }, status: { $in: ["paid", "preparing", "ready"] } })
    : 0;

  if (myOpenOrders + vendorOpenOrders > 0) {
    blockers.push({
      code: "OPEN_ORDERS",
      count: myOpenOrders + vendorOpenOrders,
      message: "Collect, hand over or cancel open food and drink orders first.",
    });
  }

  return blockers;
};

const getDeletionCheck = async ({ userId }) => {
  const user = await User.findById(userId).select("email deletedAt");

  if (!user || user.deletedAt) {
    throw new ApiError(404, "User profile not found");
  }

  const blockers = await listDeletionBlockers(userId);

  return { canDelete: blockers.length === 0, blockers, email: user.email, eraseWithinDays: ERASE_WITHIN_DAYS };
};

/* ---------- Deleting ---------- */

/** Emails the code that confirms it's really the account holder. */
const requestDeletionCode = async ({ userId }) => {
  const check = await getDeletionCheck({ userId });

  if (!check.canDelete) {
    throw new ApiError(409, "Settle the things listed first.", { blockers: check.blockers }, "DELETION_BLOCKED");
  }

  const sent = await authCodes().requestSignInCode({ email: check.email, purpose: "account-delete" });
  return { email: check.email, expiresInSeconds: sent.expiresInSeconds, resendInSeconds: sent.resendInSeconds };
};

/**
 * Deletes the account once the emailed code checks out.
 *
 * Straight away: the profile is wiped and anonymised, the email is freed,
 * every device is signed out, and follows, blocks, saves and waitlists go.
 * Then `purgeDeletedAccount` erases the rest (messages, posts, inbox and so
 * on) on the next monitor tick, well inside the promised window. Receipts
 * (tickets, payments, withdrawals) are kept because the law asks for them,
 * but stripped of the name, email and locations on them.
 */
const deleteMyAccount = async ({ userId, code }) => {
  const user = await User.findById(userId).select("email deletedAt");

  if (!user || user.deletedAt) {
    throw new ApiError(404, "User profile not found");
  }

  /* Checked again here: something may have changed since the code went out. */
  const blockers = await listDeletionBlockers(userId);

  if (blockers.length > 0) {
    throw new ApiError(409, "Settle the things listed first.", { blockers }, "DELETION_BLOCKED");
  }

  await authCodes().consumeEmailCode({ email: user.email, code });

  const now = new Date();
  const originalEmail = user.email;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        fullName: "Deleted user",
        /* Frees the address, so the person can sign up again later. */
        email: `deleted+${toIdString(userId)}@deleted.vera.invalid`,
        avatarUrl: "",
        phoneNumber: "",
        title: "",
        bio: "",
        state: "",
        dateOfBirth: null,
        passwordHash: "",
        refreshTokenHash: "",
        refreshTokenIssuedAt: null,
        pendingEmail: "",
        preferences: {},
        deletedAt: now,
        purgedAt: null,
      },
      $unset: { handle: "" },
    },
  );

  await Promise.all([
    revokeOtherSessions({ userId, exceptSessionId: null, reason: "account_deleted" }),
    DeviceToken.deleteMany({ userId }),
    Follow.deleteMany({ $or: [{ followerUserId: userId }, { followingUserId: userId }] }),
    UserBlock.deleteMany({ $or: [{ blockerUserId: userId }, { blockedUserId: userId }] }),
    SavedEvent.deleteMany({ userId }),
    EventWaitlistEntry.deleteMany({ userId }),
    TicketTransfer.updateMany(
      { $or: [{ fromUserId: userId }, { toUserId: userId }], status: "pending" },
      { $set: { status: "cancelled", respondedAt: now } },
    ),
    EmailOtp.deleteMany({ email: originalEmail }),
  ]);

  return { deleted: true, eraseWithinDays: ERASE_WITHIN_DAYS };
};

/** Erases what's left of one deleted account. Safe to run twice. */
const purgeDeletedAccount = async (userId) => {
  const tickets = await EventTicket.find({ buyerUserId: userId }).distinct("_id");

  await Promise.all([
    DirectMessage.deleteMany({ senderUserId: userId }),
    EventPost.deleteMany({ authorUserId: userId }),
    EventPostComment.deleteMany({ userId }),
    EventPostLike.deleteMany({ userId }),
    EventChatMessage.deleteMany({ userId }),
    AppNotification.deleteMany({ userId }),
    EventReminderPreference.deleteMany({ userId }),
    TicketTodo.deleteMany({ userId }),
    EventRating.deleteMany({ userId }),
    AttendanceLog.deleteMany({ userId }),
    AttendanceSession.deleteMany({ userId }),
    EventView.deleteMany({ userId }),
    Membership.deleteMany({ userId }),
    PayoutAccount.deleteMany({ organizerUserId: userId }),
    UserSession.deleteMany({ userId }),
    /* Receipts stay, without who or where. */
    EventTicket.updateMany(
      { _id: { $in: tickets } },
      {
        $set: {
          attendeeName: "",
          attendeeEmail: "",
          holderLastLatitude: null,
          holderLastLongitude: null,
          holderLocationUpdatedAt: null,
          checkInLatitude: null,
          checkInLongitude: null,
        },
      },
    ),
  ]);

  await User.updateOne({ _id: userId }, { $set: { purgedAt: new Date() } });
};

/** For the monitor: purge every deleted account not yet purged. */
const purgeDeletedAccounts = async ({ limit = 20 } = {}) => {
  const pending = await User.find({ deletedAt: { $ne: null }, purgedAt: null }).select("_id").limit(limit).lean();

  for (const user of pending) {
    try {
      await purgeDeletedAccount(user._id);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[AccountDeletion] Purge failed", { userId: String(user._id), reason: error?.message });
    }
  }

  return { purged: pending.length };
};

module.exports = {
  ERASE_WITHIN_DAYS,
  listDeletionBlockers,
  getDeletionCheck,
  requestDeletionCode,
  deleteMyAccount,
  purgeDeletedAccount,
  purgeDeletedAccounts,
};
