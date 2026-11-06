const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const Follow = require("../models/follow.model");
const SavedEvent = require("../models/saved-event.model");
const TicketTransfer = require("../models/ticket-transfer.model");
const TogetherGroup = require("../models/together-group.model");
const TogetherShare = require("../models/together-share.model");
const DirectConversation = require("../models/direct-conversation.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const User = require("../models/user.model");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { isBlockedEitherWay } = require("./account-security.service");
const { createNotification } = require("./notification.service");
const { creditTogetherPayback } = require("./wallet.service");
const { verifyPaystackTransaction } = require("./paystack.service");
const { returnPaystackPayment } = require("./payment-refund.service");
const { createTicketTransfer } = require("./ticket-transfer.service");

/* Lazy: event.service requires a lot, and some of it reaches back here through the webhook. */
const eventService = () => require("./event.service");

/**
 * Going to an event together: one person starts a group, invites friends,
 * sends them tickets they bought, and friends pay their share back through
 * Paystack into the buyer's wallet. The group has its own chat.
 *
 * Money rules (decided with the product owner):
 * - a friend gets the ticket straight away and owes for it after accepting;
 * - the share is what that ticket cost the buyer, fees included, or nothing
 *   if the buyer says it's on them;
 * - the friend pays the Paystack fee on top, so the buyer gets the exact share;
 * - the payback is pending until the event is over plus the buyer's usual
 *   settlement delay, and goes back to the friend if the event is cancelled.
 */

const MAX_PEOPLE = DirectConversation.MAX_GROUP_PARTICIPANTS;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_LIMIT = 6;
const ACTIVE = ["owner", "invited", "joined"];

/* Paystack's local card pricing: 1.5% + ₦100, the ₦100 waived under ₦2,500, capped at ₦2,000. */
const PAYSTACK = { rate: 0.015, flatKobo: 10000, waiveFlatBelowKobo: 250000, capKobo: 200000 };

const toId = (value) => String(value?._id || value || "");
const firstName = (name) => String(name || "Someone").trim().split(/\s+/)[0];
const naira = (kobo) => `₦${Math.round(Number(kobo || 0) / 100).toLocaleString("en-NG")}`;
const notify = (payload) => void createNotification({ push: true, ...payload }).catch(() => null);

const paystackFeeFor = (chargeKobo) =>
  Math.min(
    Math.ceil(chargeKobo * PAYSTACK.rate) + (chargeKobo >= PAYSTACK.waiveFlatBelowKobo ? PAYSTACK.flatKobo : 0),
    PAYSTACK.capKobo,
  );

/** The smallest charge that leaves exactly `shareKobo` after Paystack's fee. */
const chargeForShare = (shareKobo) => {
  const share = Math.max(0, Math.round(Number(shareKobo) || 0));
  if (!share) return { shareKobo: 0, feeKobo: 0, chargeKobo: 0 };
  let charge = Math.ceil(share / (1 - PAYSTACK.rate));
  if (charge >= PAYSTACK.waiveFlatBelowKobo) charge = Math.ceil((share + PAYSTACK.flatKobo) / (1 - PAYSTACK.rate));
  if (paystackFeeFor(charge) >= PAYSTACK.capKobo) charge = share + PAYSTACK.capKobo;
  while (charge - paystackFeeFor(charge) < share) charge += 1;
  return { shareKobo: share, feeKobo: charge - share, chargeKobo: charge };
};

/* ---------- Loading and checks ---------- */

const loadGroup = async (groupId) => {
  if (!mongoose.isValidObjectId(groupId)) throw new ApiError(404, "Group not found");
  const group = await TogetherGroup.findById(groupId);
  if (!group) throw new ApiError(404, "Group not found");
  return group;
};

const memberOf = (group, userId) => group.members.find((member) => toId(member.userId) === String(userId)) || null;

/* Invited people can look before they decide; declined or left can't. */
const ensureCanSee = (group, userId) => {
  const member = memberOf(group, userId);
  if (!member || !ACTIVE.includes(member.status)) throw new ApiError(404, "Group not found");
  return member;
};

const ensureOwner = (group, userId) => {
  if (toId(group.ownerUserId) !== String(userId)) throw new ApiError(403, "Only the person who started the group can do that");
};

/* Plans are for events that are still to come. */
const loadOpenEvent = async (eventId, actorUserId) => {
  if (!mongoose.isValidObjectId(eventId)) throw new ApiError(404, "Event not found");
  const event = await Event.findById(eventId);
  if (!event) throw new ApiError(404, "Event not found");
  await eventService().ensureEventCanBeViewedBy(event, actorUserId);
  if (event.status === "cancelled") throw new ApiError(409, "This event was cancelled", null, "EVENT_CANCELLED");
  /* A recurring event is only over after its last date, not its first. */
  if (eventService().hasEventEnded(event)) throw new ApiError(409, "This event has ended", null, "EVENT_ENDED");
  return event;
};

/* ---------- Presenting ---------- */

const presentUser = (user) =>
  user
    ? {
        _id: toId(user),
        fullName: user.fullName || "",
        handle: user.handle || "",
        avatarUrl: user.avatarUrl || "",
        verified: Boolean(user.verificationBadge?.verified),
      }
    : null;

/* A share as people see it: "sent" until the ticket is accepted, then owed. */
const shareState = (share, transfer, now) => {
  if (share.status !== "open") return share.status;
  if (!transfer) return "cancelled";
  if (transfer.status === "accepted") return "owed";
  if (transfer.status === "pending" && new Date(transfer.expiresAt).getTime() > now) return "sent";
  return "cancelled";
};

const presentGroup = async (group, viewerId) => {
  const now = Date.now();
  const memberIds = group.members.filter((member) => ACTIVE.includes(member.status)).map((member) => member.userId);
  const [event, users, shares, ticketHolders] = await Promise.all([
    Event.findById(group.eventId).select("name startsAt endsAt imageUrl status address").lean(),
    User.find({ _id: { $in: memberIds } }).select("fullName handle avatarUrl verificationBadge").lean(),
    TogetherShare.find({ groupId: group._id, status: { $ne: "cancelled" } }).sort({ createdAt: 1 }).lean(),
    EventTicket.distinct("buyerUserId", { eventId: group.eventId, buyerUserId: { $in: memberIds }, status: { $in: ["paid", "used"] } }),
  ]);
  const transfers = shares.length
    ? await TicketTransfer.find({ _id: { $in: shares.map((share) => share.transferId) } }).select("status expiresAt").lean()
    : [];
  const transferById = new Map(transfers.map((transfer) => [toId(transfer), transfer]));
  const userById = new Map(users.map((user) => [toId(user), user]));
  const holders = new Set(ticketHolders.map(toId));
  const isOwner = toId(group.ownerUserId) === String(viewerId);

  const presentShare = (share) => {
    const state = shareState(share, transferById.get(toId(share.transferId)), now);
    if (state === "cancelled") return null;
    const viewerOwes = toId(share.fromUserId) === String(viewerId) && state === "owed";
    return {
      _id: toId(share),
      fromUserId: toId(share.fromUserId),
      toUserId: toId(share.toUserId),
      amountNaira: Math.round(share.amountKobo / 100),
      state,
      paidAt: share.paidAt,
      canNudge: isOwner && state === "owed" && (!share.lastNudgedAt || now - new Date(share.lastNudgedAt).getTime() >= DAY_MS),
      /* Only the person paying sees what they'd be charged. */
      payment: viewerOwes
        ? (({ shareKobo, feeKobo, chargeKobo }) => ({
            shareNaira: shareKobo / 100,
            feeNaira: feeKobo / 100,
            totalNaira: chargeKobo / 100,
          }))(chargeForShare(share.amountKobo))
        : null,
    };
  };
  const presentedShares = shares.map(presentShare).filter(Boolean);

  const members = group.members
    .filter((member) => ACTIVE.includes(member.status))
    .map((member) => {
      const id = toId(member.userId);
      return {
        user: presentUser(userById.get(id)),
        status: member.status,
        invitedAt: member.invitedAt,
        hasTicket: holders.has(id),
        canRemind:
          isOwner && member.status === "invited" && (!member.lastRemindedAt || now - new Date(member.lastRemindedAt).getTime() >= DAY_MS),
        /* What they've been sent from this group, newest last. */
        shares: presentedShares.filter((share) => share.fromUserId === id),
      };
    })
    .filter((member) => member.user);

  return {
    _id: toId(group),
    event: event
      ? { _id: toId(event), name: event.name, startsAt: event.startsAt, endsAt: event.endsAt, imageUrl: event.imageUrl || "", status: event.status }
      : null,
    ownerUserId: toId(group.ownerUserId),
    isOwner,
    viewerStatus: memberOf(group, viewerId)?.status || null,
    conversationId: group.conversationId ? toId(group.conversationId) : null,
    members,
    goingCount: members.filter((member) => member.status === "owner" || member.status === "joined").length,
  };
};

/* ---------- Groups ---------- */

/** Starts a group for an event, or opens the one you already have. */
const startGroup = async ({ eventId, actorUserId }) => {
  const event = await loadOpenEvent(eventId, actorUserId);
  let group = await TogetherGroup.findOne({ eventId: event._id, ownerUserId: actorUserId });

  if (!group) {
    try {
      group = await TogetherGroup.create({
        eventId: event._id,
        ownerUserId: actorUserId,
        members: [{ userId: actorUserId, status: "owner", respondedAt: new Date() }],
      });
    } catch (error) {
      /* Two taps at once: the other request made it. */
      if (error?.code !== 11000) throw error;
      group = await TogetherGroup.findOne({ eventId: event._id, ownerUserId: actorUserId });
    }
  }

  if (!group.conversationId) {
    const directKey = `together:${group._id}`;
    let conversation = await DirectConversation.findOne({ directKey });
    if (!conversation) {
      try {
        conversation = await DirectConversation.create({
          directKey,
          kind: "group",
          title: event.name,
          eventId: event._id,
          togetherGroupId: group._id,
          participants: [actorUserId],
          createdByUserId: actorUserId,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        conversation = await DirectConversation.findOne({ directKey });
      }
    }
    group.conversationId = conversation._id;
    await group.save();
  }

  return presentGroup(group, actorUserId);
};

const getGroup = async ({ groupId, actorUserId }) => {
  const group = await loadGroup(groupId);
  ensureCanSee(group, actorUserId);
  return presentGroup(group, actorUserId);
};

/** Groups you're in or invited to, optionally for one event. */
const listMyGroups = async ({ actorUserId, eventId }) => {
  const query = { members: { $elemMatch: { userId: actorUserId, status: { $in: ACTIVE } } } };
  if (eventId && mongoose.isValidObjectId(eventId)) query.eventId = eventId;
  const groups = await TogetherGroup.find(query).sort({ updatedAt: -1 }).limit(30);
  return { items: await Promise.all(groups.map((group) => presentGroup(group, actorUserId))) };
};

const invite = async ({ groupId, actorUserId, userIds }) => {
  const group = await loadGroup(groupId);
  ensureOwner(group, actorUserId);
  const event = await loadOpenEvent(group.eventId, actorUserId);

  const wanted = [...new Set((userIds || []).map(String))].filter((id) => mongoose.isValidObjectId(id) && id !== String(actorUserId));
  const users = await User.find({ _id: { $in: wanted }, deletedAt: null }).select("_id").lean();
  const owner = await User.findById(actorUserId).select("fullName").lean();
  const now = new Date();
  const invited = [];

  for (const user of users) {
    const id = toId(user);
    /* Someone either of you blocked is quietly skipped, never told why. */
    if (await isBlockedEitherWay(actorUserId, id)) continue;
    const existing = memberOf(group, id);
    if (existing && ACTIVE.includes(existing.status)) continue;
    if (group.members.filter((member) => ACTIVE.includes(member.status)).length >= MAX_PEOPLE) {
      throw new ApiError(409, `A group can have up to ${MAX_PEOPLE} people`, null, "GROUP_FULL");
    }
    if (existing) {
      Object.assign(existing, { status: "invited", invitedByUserId: actorUserId, invitedAt: now, respondedAt: null, lastRemindedAt: null });
    } else {
      group.members.push({ userId: id, status: "invited", invitedByUserId: actorUserId, invitedAt: now });
    }
    invited.push(id);
  }

  await group.save();

  for (const id of invited) {
    notify({
      userId: id,
      type: "together.invite",
      title: `${firstName(owner?.fullName)} wants to go together`,
      message: `To ${event.name}. Open it to say if you're in.`,
      data: { target: "together", groupId: toId(group), eventId: toId(event) },
    });
  }

  return presentGroup(group, actorUserId);
};

const respond = async ({ groupId, actorUserId, accept }) => {
  const group = await loadGroup(groupId);
  const member = memberOf(group, actorUserId);
  if (!member || member.status !== "invited") throw new ApiError(409, "There's no invite to answer", null, "NO_INVITE");

  member.status = accept ? "joined" : "declined";
  member.respondedAt = new Date();
  await group.save();

  if (accept && group.conversationId) {
    await DirectConversation.updateOne({ _id: group.conversationId }, { $addToSet: { participants: actorUserId } });
  }

  const [me, event] = await Promise.all([
    User.findById(actorUserId).select("fullName").lean(),
    Event.findById(group.eventId).select("name").lean(),
  ]);
  notify({
    userId: group.ownerUserId,
    type: accept ? "together.joined" : "together.declined",
    title: accept ? `${firstName(me?.fullName)} is in` : `${firstName(me?.fullName)} can't make it`,
    message: accept ? `Going to ${event?.name || "the event"} with you.` : `They said no to ${event?.name || "the event"}.`,
    data: { target: "together", groupId: toId(group), eventId: toId(group.eventId) },
  });

  return accept ? presentGroup(group, actorUserId) : { _id: toId(group), viewerStatus: "declined" };
};

/* Leaving doesn't cancel what you owe: the ticket is still yours. */
const leave = async ({ groupId, actorUserId }) => {
  const group = await loadGroup(groupId);
  const member = memberOf(group, actorUserId);
  if (!member || member.status !== "joined") throw new ApiError(409, "You're not in this group");
  member.status = "left";
  member.respondedAt = new Date();
  await group.save();
  if (group.conversationId) {
    await DirectConversation.updateOne({ _id: group.conversationId }, { $pull: { participants: new mongoose.Types.ObjectId(String(actorUserId)) } });
  }
  return { _id: toId(group), viewerStatus: "left" };
};

const remind = async ({ groupId, actorUserId, userId }) => {
  const group = await loadGroup(groupId);
  ensureOwner(group, actorUserId);
  const member = memberOf(group, userId);
  if (!member || member.status !== "invited") throw new ApiError(409, "They've already answered");
  if (member.lastRemindedAt && Date.now() - new Date(member.lastRemindedAt).getTime() < DAY_MS) {
    throw new ApiError(429, "You can remind them again tomorrow", null, "REMIND_LIMIT");
  }
  member.lastRemindedAt = new Date();
  await group.save();

  const [owner, event] = await Promise.all([
    User.findById(actorUserId).select("fullName").lean(),
    Event.findById(group.eventId).select("name").lean(),
  ]);
  notify({
    userId,
    type: "together.reminder",
    title: `${firstName(owner?.fullName)} is still waiting`,
    message: `Are you coming to ${event?.name || "the event"}?`,
    data: { target: "together", groupId: toId(group), eventId: toId(group.eventId) },
  });
  return presentGroup(group, actorUserId);
};

/**
 * "They'd like this too": people the owner follows who aren't in the group,
 * best reason first. Only reasons the owner could see anyway.
 */
const suggestions = async ({ groupId, actorUserId }) => {
  const group = await loadGroup(groupId);
  ensureOwner(group, actorUserId);
  const inGroup = new Set(group.members.filter((member) => ACTIVE.includes(member.status)).map((member) => toId(member.userId)));

  const following = (await Follow.find({ followerUserId: actorUserId }).select("followingUserId").limit(500).lean())
    .map((row) => toId(row.followingUserId))
    .filter((id) => !inGroup.has(id));
  if (!following.length) return { items: [] };

  const [saved, going, users] = await Promise.all([
    SavedEvent.distinct("userId", { eventId: group.eventId, userId: { $in: following } }),
    EventTicket.distinct("buyerUserId", { eventId: group.eventId, buyerUserId: { $in: following }, status: { $in: ["paid", "used"] } }),
    User.find({ _id: { $in: following }, deletedAt: null }).select("fullName handle avatarUrl verificationBadge").lean(),
  ]);
  const savedSet = new Set(saved.map(toId));
  const goingSet = new Set(going.map(toId));
  const rank = (id) => (goingSet.has(id) ? 0 : savedSet.has(id) ? 1 : 2);

  const items = [];
  for (const user of users.sort((a, b) => rank(toId(a)) - rank(toId(b)))) {
    if (items.length >= SUGGESTION_LIMIT) break;
    if (await isBlockedEitherWay(actorUserId, user._id)) continue;
    const id = toId(user);
    items.push({ user: presentUser(user), why: goingSet.has(id) ? "already going" : savedSet.has(id) ? "saved it" : "you follow them" });
  }
  return { items };
};

/* ---------- Tickets and shares ---------- */

/**
 * Sends one of the owner's tickets to someone in the group, through the
 * ordinary ticket transfer, and records what they'll owe for it.
 */
const sendTicket = async ({ groupId, actorUserId, ticketId, toUserId, onMe = false }) => {
  const group = await loadGroup(groupId);
  ensureOwner(group, actorUserId);
  await loadOpenEvent(group.eventId, actorUserId);

  const member = memberOf(group, toUserId);
  if (!member || member.status !== "joined") throw new ApiError(409, "They need to join the group first", null, "NOT_A_MEMBER");

  if (!mongoose.isValidObjectId(ticketId)) throw new ApiError(404, "Ticket not found");
  const ticket = await EventTicket.findById(ticketId);
  if (!ticket || toId(ticket.eventId) !== toId(group.eventId)) throw new ApiError(404, "Ticket not found");
  /* The rest (yours, unused, not listed for resale) is checked by the transfer itself. */

  const recipient = await User.findById(toUserId).select("email").lean();
  if (!recipient?.email) throw new ApiError(404, "We couldn't send it to that person");

  const transfer = await createTicketTransfer({ ticketId, actorUserId, payload: { to: recipient.email, note: "From your Together group" } });

  /* A re-send replaced any earlier send of this ticket, so its share goes too. */
  await TogetherShare.updateMany({ ticketId: ticket._id, status: "open" }, { $set: { status: "cancelled" } });

  const share = await TogetherShare.create({
    groupId: group._id,
    eventId: group.eventId,
    fromUserId: toUserId,
    toUserId: actorUserId,
    ticketId: ticket._id,
    transferId: transfer._id,
    amountKobo: onMe ? 0 : Math.round(Number(ticket.totalPriceNaira || 0) * 100),
    status: onMe || !(Number(ticket.totalPriceNaira) > 0) ? "on_me" : "open",
  });

  return { share: { _id: toId(share), status: share.status }, group: await presentGroup(group, actorUserId) };
};

const loadShare = async (shareId) => {
  if (!mongoose.isValidObjectId(shareId)) throw new ApiError(404, "Not found");
  const share = await TogetherShare.findById(shareId);
  if (!share) throw new ApiError(404, "Not found");
  return share;
};

/** The owner lets someone off: they owe nothing. */
const coverShare = async ({ shareId, actorUserId }) => {
  const share = await loadShare(shareId);
  if (toId(share.toUserId) !== String(actorUserId)) throw new ApiError(404, "Not found");
  const covered = await TogetherShare.findOneAndUpdate({ _id: share._id, status: "open" }, { $set: { status: "on_me" } }, { new: true });
  if (!covered) throw new ApiError(409, "This share is already settled");
  return getGroup({ groupId: share.groupId, actorUserId });
};

const nudge = async ({ shareId, actorUserId }) => {
  const share = await loadShare(shareId);
  if (toId(share.toUserId) !== String(actorUserId)) throw new ApiError(404, "Not found");
  const transfer = await TicketTransfer.findById(share.transferId).select("status").lean();
  if (share.status !== "open" || transfer?.status !== "accepted") throw new ApiError(409, "There's nothing to nudge them about");

  const cutoff = new Date(Date.now() - DAY_MS);
  const claimed = await TogetherShare.findOneAndUpdate(
    { _id: share._id, $or: [{ lastNudgedAt: null }, { lastNudgedAt: { $lte: cutoff } }] },
    { $set: { lastNudgedAt: new Date() } },
  );
  if (!claimed) throw new ApiError(429, "You can nudge them again tomorrow", null, "NUDGE_LIMIT");

  const [owner, event] = await Promise.all([
    User.findById(actorUserId).select("fullName").lean(),
    Event.findById(share.eventId).select("name").lean(),
  ]);
  notify({
    userId: share.fromUserId,
    type: "together.nudge",
    title: `${firstName(owner?.fullName)} sent a nudge`,
    message: `${naira(share.amountKobo)} for your ticket to ${event?.name || "the event"}. Tap to pay them back.`,
    data: { target: "together", groupId: toId(share.groupId), eventId: toId(share.eventId) },
  });
  return getGroup({ groupId: share.groupId, actorUserId });
};

/** The friend starts paying their share: the share plus Paystack's fee. */
const startSharePayment = async ({ shareId, actorUserId, callbackUrl }) => {
  const share = await loadShare(shareId);
  if (toId(share.fromUserId) !== String(actorUserId)) throw new ApiError(404, "Not found");
  if (share.status === "paid") throw new ApiError(409, "You've already paid this", null, "ALREADY_PAID");
  if (share.status !== "open") throw new ApiError(409, "There's nothing to pay", null, "NOTHING_OWED");

  const transfer = await TicketTransfer.findById(share.transferId).select("status").lean();
  if (transfer?.status !== "accepted") throw new ApiError(409, "Accept the ticket first, then pay for it", null, "TICKET_NOT_ACCEPTED");

  const event = await Event.findById(share.eventId).select("status endsAt").lean();
  if (!event || event.status === "cancelled") throw new ApiError(409, "This event was cancelled, so there's nothing to pay", null, "EVENT_CANCELLED");

  const { chargeKobo, feeKobo } = chargeForShare(share.amountKobo);
  const devBypass = !env.paystackSecretKey && env.paystackDevBypass;
  if (!env.paystackSecretKey && !devBypass) {
    throw new ApiError(503, "Payments aren't set up yet. Set PAYSTACK_SECRET_KEY.");
  }

  if (devBypass) {
    await finalizeSharePayment({ share, reference: `dev_together_${share._id}`, chargedKobo: chargeKobo });
    return { requiresPayment: false, payment: null, group: await getGroup({ groupId: share.groupId, actorUserId }) };
  }

  const me = await User.findById(actorUserId).select("email").lean();
  const attempt = await eventService().createPaymentAttemptForCheckout({
    kind: "together_share",
    buyerUserId: actorUserId,
    eventId: share.eventId,
    togetherShareId: share._id,
    amountKobo: chargeKobo,
    callbackUrl: String(callbackUrl || env.paystackCallbackUrl || ""),
    email: me?.email,
    referenceSuffix: String(share._id),
    metadata: { togetherShareId: String(share._id), groupId: String(share.groupId) },
  });

  return {
    requiresPayment: true,
    payment: { reference: attempt.reference, authorizationUrl: attempt.authorizationUrl, accessCode: attempt.accessCode },
    pricing: { shareNaira: share.amountKobo / 100, feeNaira: feeKobo / 100, totalNaira: chargeKobo / 100 },
  };
};

/**
 * Marks a share paid and credits the owner, once. If it was already settled
 * another way (paid twice, or covered while they were paying), this payment
 * goes straight back to the friend.
 */
const finalizeSharePayment = async ({ share, reference, chargedKobo }) => {
  const stored = await Event.findById(share.eventId).select("_id startsAt endsAt status recurrence").lean();
  /* Settles after the date they're going to: for a recurring event, the current one, not the first. */
  const event = stored ? { ...stored, endsAt: eventService().currentOccurrenceEndsAt(stored) || stored.endsAt } : stored;

  const paid = await withMongoTransaction(async (session) => {
    const claimed = await TogetherShare.findOneAndUpdate(
      { _id: share._id, status: "open" },
      { $set: { status: "paid", paymentReference: reference, chargedKobo, paidAt: new Date() } },
      { new: true, session },
    );
    if (!claimed) return null;
    if (env.walletCreditingEnabled) await creditTogetherPayback({ share: claimed, event, session });
    return claimed;
  });

  if (!paid) {
    const current = await TogetherShare.findById(share._id).select("paymentReference").lean();
    if (current?.paymentReference !== reference && !reference.startsWith("dev_")) {
      await returnPaystackPayment({ reference, amountKobo: chargedKobo });
    }
    return null;
  }

  const [friend, eventName] = await Promise.all([
    User.findById(paid.fromUserId).select("fullName").lean(),
    Event.findById(paid.eventId).select("name").lean(),
  ]);
  notify({
    userId: paid.toUserId,
    type: "together.paid",
    title: `${firstName(friend?.fullName)} paid you back`,
    message: `${naira(paid.amountKobo)} for their ticket to ${eventName?.name || "the event"}. It's in your wallet after the event.`,
    data: { target: "together", groupId: toId(paid.groupId), eventId: toId(paid.eventId) },
  });
  return paid;
};

/** Called by the Paystack webhook (charge.success) for "together_share" payments. */
const finalizeSharePaymentAttempt = async ({ paymentAttempt, paymentData }) => {
  const share = paymentAttempt.togetherShareId ? await TogetherShare.findById(paymentAttempt.togetherShareId) : null;
  if (!share) throw new ApiError(404, "Share not found for this payment");

  await finalizeSharePayment({
    share,
    reference: paymentAttempt.reference,
    chargedKobo: Number(paymentData?.amount || paymentAttempt.amountKobo),
  });

  paymentAttempt.status = "success";
  paymentAttempt.fulfillmentStatus = "done";
  paymentAttempt.fulfilledAt = paymentAttempt.fulfilledAt || new Date();
  await paymentAttempt.save();
};

/** Back from Paystack: checked against Paystack, never the app's word. */
const verifySharePayment = async ({ shareId, actorUserId, reference }) => {
  const share = await loadShare(shareId);
  if (toId(share.fromUserId) !== String(actorUserId)) throw new ApiError(404, "Not found");

  const attempt = await PaymentAttempt.findOne({ reference: String(reference || ""), togetherShareId: share._id });
  if (!attempt) throw new ApiError(404, "Payment not found");

  if (share.status === "open" && attempt.fulfillmentStatus !== "done") {
    const paymentData = await verifyPaystackTransaction(attempt.reference);
    if (String(paymentData?.status) !== "success") throw new ApiError(409, "That payment hasn't gone through", null, "PAYMENT_NOT_COMPLETE");
    if (Number(paymentData?.amount || 0) < attempt.amountKobo) throw new ApiError(409, "The amount paid is less than the share");
    await finalizeSharePaymentAttempt({ paymentAttempt: attempt, paymentData });
  }

  return getGroup({ groupId: share.groupId, actorUserId });
};

/**
 * The event was cancelled: paid shares go back to the friends who paid them,
 * and nothing more is owed. Run by the cancellation sweep.
 */
const settleSharesForCancelledEvent = async ({ eventId, reason }) => {
  const { refundTogetherShare } = require("./refund.service");
  await TogetherShare.updateMany({ eventId, status: "open" }, { $set: { status: "cancelled" } });
  const paid = await TogetherShare.find({ eventId, status: "paid" }).select("_id").limit(200).lean();
  for (const share of paid) {
    try {
      await refundTogetherShare({ shareId: share._id, reason });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[together] could not refund share", String(share._id), error?.message);
    }
  }
};

module.exports = {
  chargeForShare,
  startGroup,
  getGroup,
  listMyGroups,
  invite,
  respond,
  leave,
  remind,
  suggestions,
  sendTicket,
  coverShare,
  nudge,
  startSharePayment,
  verifySharePayment,
  finalizeSharePaymentAttempt,
  settleSharesForCancelledEvent,
};
