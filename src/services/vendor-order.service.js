const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const EventVendor = require("../models/event-vendor.model");
const PaymentAttempt = require("../models/payment-attempt.model");
const User = require("../models/user.model");
const Vendor = require("../models/vendor.model");
const VendorItem = require("../models/vendor-item.model");
const VendorOrder = require("../models/vendor-order.model");
const VendorRating = require("../models/vendor-rating.model");
const ApiError = require("../utils/api-error");
const env = require("../config/env");
const { computeVendorOrderPricing } = require("../config/vendor-fees");
const { limitForLevel } = require("../config/vendor-limits");
const { ADULT_AGE, isAdult } = require("../utils/age");
const { withMongoTransaction } = require("../utils/with-mongo-transaction");
const { creditVendorOrder } = require("./wallet.service");
const {
  createPaymentAttemptForCheckout,
  resolveOccurrenceWindow,
} = require("./event.service");
const {
  initiatePaystackRefund,
  verifyPaystackTransaction,
} = require("./paystack.service");
const { createNotification } = require("./notification.service");

/**
 * Orders placed with a vendor at an event.
 *
 * The rule the whole feature rests on: money is taken at checkout and held.
 * Nothing reaches the vendor until `collected`, and anything cancelled before
 * that is refunded to the buyer. Wallet credits therefore happen in exactly
 * one place, `collectOrder`.
 */

/* What a vendor can still act on tonight. */
const LIVE_STATUSES = ["paid", "preparing", "ready"];
const CODE_ATTEMPTS = 8;

const toIdString = (value) => String(value?._id || value || "");

const mapOrder = (order, { vendor = null, event = null } = {}) => ({
  _id: toIdString(order),
  eventId: toIdString(order.eventId),
  vendorId: toIdString(order.vendorId),
  buyerUserId: toIdString(order.buyerUserId),
  pickupCode: order.pickupCode,
  status: order.status,
  lines: (order.lines || []).map((line) => ({
    itemId: toIdString(line.itemId),
    name: line.name,
    unitPriceNaira: line.unitPriceNaira,
    quantity: line.quantity,
    lineTotalNaira: line.lineTotalNaira,
  })),
  note: order.note || "",
  pricing: {
    subtotalNaira: order.pricing.subtotalNaira,
    serviceFeeNaira: order.pricing.serviceFeeNaira,
    totalChargedNaira: order.pricing.totalChargedNaira,
    /* The split is the vendor's business, not the buyer's, but both sides
       read orders through this shape. */
    veraFeeNaira: order.pricing.veraFeeNaira,
    vendorNetNaira: order.pricing.vendorNetNaira,
  },
  paidAt: order.paidAt,
  readyAt: order.readyAt,
  collectedAt: order.collectedAt,
  cancelReason: order.cancelReason || "",
  createdAt: order.createdAt,
  ...(vendor
    ? {
        vendor: {
          _id: toIdString(vendor),
          businessName: vendor.businessName,
          logoUrl: vendor.logoUrl || "",
          slug: vendor.slug,
        },
      }
    : {}),
  ...(event
    ? {
        event: {
          _id: toIdString(event),
          name: event.name,
          startsAt: event.startsAt,
        },
      }
    : {}),
});

/**
 * Whether this event is happening right now.
 *
 * Orders are only taken while it is. A stall is a thing you walk up to, so
 * ordering from one the day before is either a mistake or a way to have food
 * go cold; either way the vendor is not there to make it.
 *
 * Recurrence-aware: a weekly event is live during this week's occurrence, not
 * from its first ever start date.
 */
/** True once the window has closed, rather than not yet opened. */
const hasEnded = (liveness) => Date.now() > liveness.endsAt.getTime();

const resolveLiveness = (event, now = new Date()) => {
  const occurrence = resolveOccurrenceWindow(event, now) || {
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
  };

  return {
    live:
      now.getTime() >= occurrence.startsAt.getTime() &&
      now.getTime() <= occurrence.endsAt.getTime(),
    /* Sent rather than worked out on the client: a phone's clock is not
       something to decide "closed" by. */
    ended: now.getTime() > occurrence.endsAt.getTime(),
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
  };
};

/**
 * Tells someone about their order.
 *
 * createNotification already stores it, pushes it and emits it on the
 * user's socket, so a phone in a pocket hears about a ready order and
 * neither side has to sit watching a screen.
 *
 * Never allowed to fail the thing it is reporting: an order is still ready
 * whether or not the message got out.
 */
const notify = async ({ userId, type, title, message, order }) => {
  try {
    await createNotification({
      userId,
      type,
      title,
      message,
      data: {
        vendorOrderId: toIdString(order),
        eventId: toIdString(order.eventId),
        pickupCode: order.pickupCode,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[vendor-order] notify failed", {
      orderId: toIdString(order),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

const orderSummary = (order) =>
  order.lines
    .map((line) => `${line.quantity} × ${line.name}`)
    .join(", ")
    .slice(0, 120);

/** Four digits, retried on collision rather than trusted to be unique. */
const buildPickupCode = () =>
  String(Math.floor(1000 + Math.random() * 9000));

/**
 * Buying is for people who hold a ticket to the event.
 *
 * Walk-ups through a stall's QR code are a separate door that does not exist
 * yet; until it does, an order belongs to someone who is actually coming.
 */
const requireTicketHolder = async ({ eventId, actorUserId }) => {
  const hasTicket = await EventTicket.exists({
    eventId,
    buyerUserId: actorUserId,
    status: { $in: ["paid", "used"] },
  });

  if (!hasTicket) {
    throw new ApiError(
      403,
      "You need a ticket for this event to order from its vendors",
      null,
      "TICKET_REQUIRED",
    );
  }
};

const requireOwnVendor = async (actorUserId) => {
  const vendor = await Vendor.findOne({ ownerUserId: actorUserId });

  if (!vendor) {
    throw new ApiError(404, "You do not have a vendor account yet", null, "VENDOR_NOT_FOUND");
  }

  if (vendor.status === "suspended") {
    throw new ApiError(403, "This vendor account is suspended");
  }

  return vendor;
};

/** A vendor confirmed for this event, with its service state. */
const requireConfirmedBooking = async ({ eventId, vendorId }) => {
  const booking = await EventVendor.findOne({
    eventId,
    vendorId,
    status: "confirmed",
  });

  if (!booking) {
    throw new ApiError(404, "That vendor is not selling at this event");
  }

  return booking;
};

/* ------------------------------------------------------------------ buyers */

/** Who is selling at this event right now, and how long they say they are. */
const listEventVendorsForBuyers = async ({ eventId, actorUserId }) => {
  const event = await Event.findById(eventId);

  if (!event || event.status !== "published") {
    throw new ApiError(404, "Event not found");
  }

  await requireTicketHolder({ eventId: event._id, actorUserId });

  const bookings = await EventVendor.find({
    eventId: event._id,
    status: "confirmed",
  }).populate("vendorId");

  const liveness = resolveLiveness(event);

  const items = bookings
    .filter((booking) => booking.vendorId && booking.vendorId.status === "active")
    .map((booking) => ({
      vendorId: toIdString(booking.vendorId),
      businessName: booking.vendorId.businessName,
      logoUrl: booking.vendorId.logoUrl || "",
      slug: booking.vendorId.slug,
      categories: booking.vendorId.categories || [],
      averageRating: booking.vendorId.averageRating || 0,
      ratingsCount: booking.vendorId.ratingsCount || 0,
      stallLabel: booking.terms?.stallLabel || "",
      /* Closed to everyone until the event is under way, whatever the vendor
         has switched on. The client never has to work this out itself. */
      acceptingOrders: liveness.live && Boolean(booking.acceptingOrders),
      prepMinutes: booking.prepMinutes ?? null,
    }));

  return {
    items,
    event: {
      _id: toIdString(event),
      name: event.name,
      live: liveness.live,
      ended: liveness.ended,
      startsAt: liveness.startsAt,
      endsAt: liveness.endsAt,
    },
  };
};

/** One vendor's menu, as a buyer at this event sees it. */
const getVendorMenuForBuyers = async ({ eventId, vendorId, actorUserId }) => {
  await requireTicketHolder({ eventId, actorUserId });

  const booking = await requireConfirmedBooking({ eventId, vendorId });
  const vendor = await Vendor.findOne({ _id: vendorId, status: "active" });

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  const event = await Event.findById(eventId);
  const liveness = resolveLiveness(event);

  const items = await VendorItem.find({
    vendorId: vendor._id,
    available: true,
  }).sort({ position: 1, createdAt: 1 });

  /* Tonight's counts override the item's own, so a menu reused across events
     shows what is actually left at this one. */
  const tonight = new Map(
    (booking.itemStock || []).map((row) => [
      toIdString(row.itemId),
      row.remaining,
    ]),
  );

  const sections = [...vendor.sections]
    .sort((left, right) => left.position - right.position)
    .map((section) => ({
      _id: toIdString(section),
      name: section.name,
      items: [],
    }));
  const fallback = { _id: null, name: "Menu", items: [] };
  const byId = new Map(sections.map((section) => [section._id, section]));

  for (const item of items) {
    const remaining = tonight.has(toIdString(item))
      ? tonight.get(toIdString(item))
      : item.stock;

    /* Sold out, either for tonight or altogether: it cannot be bought, so
       buyers never see it. */
    if (remaining !== null && remaining <= 0) {
      continue;
    }

    const bucket =
      (item.sectionId && byId.get(toIdString(item.sectionId))) || fallback;

    bucket.items.push({
      _id: toIdString(item),
      name: item.name,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      priceNaira: item.priceNaira,
      category: item.category,
      stock: remaining,
      ageRestricted: Boolean(item.ageRestricted),
    });
  }

  return {
    vendor: {
      _id: toIdString(vendor),
      businessName: vendor.businessName,
      logoUrl: vendor.logoUrl || "",
      slug: vendor.slug,
      stallLabel: booking.terms?.stallLabel || "",
      acceptingOrders: liveness.live && Boolean(booking.acceptingOrders),
      prepMinutes: booking.prepMinutes ?? null,
    },
    event: {
      live: liveness.live,
      ended: liveness.ended,
      startsAt: liveness.startsAt,
      endsAt: liveness.endsAt,
    },
    sections: [...(fallback.items.length ? [fallback] : []), ...sections].filter(
      (section) => section.items.length > 0,
    ),
  };
};

/**
 * Takes stock for one line, atomically.
 *
 * The condition is in the query, not in JavaScript: two people ordering the
 * last plate at the same moment must not both be told yes.
 */
/**
 * Takes from tonight's count for this event, if the vendor set one.
 *
 * Returns false when there is no entry, so the caller falls back to the
 * item's own stock. The condition is in the query either way: the last plate
 * can only be sold once.
 */
const reserveEventStock = async ({ bookingId, itemId, quantity }) => {
  const updated = await EventVendor.findOneAndUpdate(
    {
      _id: bookingId,
      itemStock: { $elemMatch: { itemId, remaining: { $gte: quantity } } },
    },
    { $inc: { "itemStock.$.remaining": -quantity } },
    { new: true },
  );

  if (updated) {
    return "taken";
  }

  /* Either there is no entry for this item, or there is and it is short. */
  const booking = await EventVendor.findById(bookingId).select("itemStock");
  const entry = (booking?.itemStock || []).find(
    (row) => toIdString(row.itemId) === toIdString(itemId),
  );

  return entry ? "short" : "no-entry";
};

const releaseEventStock = async ({ bookingId, lines }) => {
  for (const line of lines) {
    await EventVendor.updateOne(
      { _id: bookingId, "itemStock.itemId": line.itemId },
      { $inc: { "itemStock.$.remaining": line.quantity } },
    );
  }
};

const reserveStock = async (itemId, quantity) => {
  /* An item with no limit has no counter to race on, so there is nothing to
     take: confirming it is still sellable is the whole check. */
  const unlimited = await VendorItem.findOne({
    _id: itemId,
    available: true,
    stock: null,
  });

  if (unlimited) {
    return unlimited;
  }

  /* Counted stock: the condition lives in the query so two people ordering
     the last plate cannot both be told yes. */
  return VendorItem.findOneAndUpdate(
    { _id: itemId, available: true, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { new: true },
  );
};

const releaseStock = async (lines) => {
  for (const line of lines) {
    await VendorItem.updateOne(
      { _id: line.itemId, stock: { $ne: null } },
      { $inc: { stock: line.quantity } },
    );
  }
};

/**
 * Stops a vendor selling past the level they are verified for.
 *
 * Counted on orders that were actually paid for, held ones included: money
 * taken is money taken, whether or not it has been handed over yet.
 */
const assertWithinSalesLimit = async ({ vendor, orderSubtotalNaira }) => {
  const limit = limitForLevel(vendor.verificationLevel);

  if (limit === null) {
    return;
  }

  const [summary] = await VendorOrder.aggregate([
    {
      $match: {
        vendorId: vendor._id,
        status: { $in: ["paid", "preparing", "ready", "collected"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$pricing.subtotalNaira" } } },
  ]);

  const soldSoFar = Number(summary?.total || 0);

  if (soldSoFar + orderSubtotalNaira > limit) {
    throw new ApiError(
      409,
      "This vendor has reached their sales limit and cannot take new orders yet",
      { limitNaira: limit },
      "VENDOR_LIMIT_REACHED",
    );
  }
};

/**
 * Places an order and, when there is anything to pay, starts its payment.
 *
 * Whether to charge is decided by what the basket costs, never by a flag
 * elsewhere: a ₦0 basket is handed over immediately, anything above it is
 * paid for first.
 */
const placeOrder = async ({ eventId, vendorId, actorUserId, payload }) => {
  const event = await Event.findById(eventId);

  if (!event || event.status !== "published") {
    throw new ApiError(404, "Event not found");
  }

  await requireTicketHolder({ eventId: event._id, actorUserId });

  const liveness = resolveLiveness(event);

  if (!liveness.live) {
    throw new ApiError(
      409,
      hasEnded(liveness)
        ? "This event has ended, so its stalls are closed"
        : "Orders open when the event starts",
      { startsAt: liveness.startsAt, endsAt: liveness.endsAt },
      "EVENT_NOT_LIVE",
    );
  }

  const booking = await requireConfirmedBooking({ eventId: event._id, vendorId });

  if (!booking.acceptingOrders) {
    throw new ApiError(409, "This vendor has paused orders for now");
  }

  const vendor = await Vendor.findOne({ _id: vendorId, status: "active" });

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  const requested = Array.isArray(payload.items) ? payload.items : [];

  if (requested.length === 0) {
    throw new ApiError(400, "Your order is empty");
  }

  const reserved = [];
  const eventReserved = [];
  const lines = [];

  try {
    for (const entry of requested) {
      const quantity = Math.max(1, Math.round(Number(entry.quantity || 1)));
      const tonight = await reserveEventStock({
        bookingId: booking._id,
        itemId: entry.itemId,
        quantity,
      });

      if (tonight === "short") {
        throw new ApiError(
          409,
          "One of those items just sold out or is no longer on the menu",
          { itemId: entry.itemId },
          "ITEM_UNAVAILABLE",
        );
      }

      /* Only fall back to the item's own stock when this event has no count
         of its own for it. */
      const item =
        tonight === "taken"
          ? await VendorItem.findOne({ _id: entry.itemId, available: true })
          : await reserveStock(entry.itemId, quantity);

      if (tonight === "taken") {
        eventReserved.push({ itemId: entry.itemId, quantity });
      }

      if (!item || toIdString(item.vendorId) !== toIdString(vendor)) {
        throw new ApiError(
          409,
          "One of those items just sold out or is no longer on the menu",
          { itemId: entry.itemId },
          "ITEM_UNAVAILABLE",
        );
      }

      reserved.push({ itemId: item._id, quantity });
      lines.push({
        itemId: item._id,
        name: item.name,
        unitPriceNaira: item.priceNaira,
        quantity,
        lineTotalNaira: item.priceNaira * quantity,
        ageRestricted: Boolean(item.ageRestricted),
      });
    }

    /* Alcohol and the like: checked against the buyer's own date of birth,
       and refused outright rather than left to the counter. A buyer who has
       never told us is asked once, here. */
    if (lines.some((line) => line.ageRestricted)) {
      const buyer = await User.findById(actorUserId).select("dateOfBirth");

      if (!buyer?.dateOfBirth) {
        throw new ApiError(
          403,
          `Add your date of birth to your profile to buy ${ADULT_AGE}+ items`,
          null,
          "DATE_OF_BIRTH_REQUIRED",
        );
      }

      if (!isAdult(buyer.dateOfBirth)) {
        throw new ApiError(
          403,
          `You must be ${ADULT_AGE} or older to buy that`,
          null,
          "UNDERAGE",
        );
      }
    }

    const pricing = computeVendorOrderPricing({
      subtotalNaira: lines.reduce((sum, line) => sum + line.lineTotalNaira, 0),
    });

    await assertWithinSalesLimit({ vendor, orderSubtotalNaira: pricing.subtotalNaira });

    const requiresPayment = pricing.totalChargedNaira > 0;
    const shouldBypassPaystack =
      requiresPayment && !env.paystackSecretKey && env.paystackDevBypass;

    if (requiresPayment && !env.paystackSecretKey && !shouldBypassPaystack) {
      throw new ApiError(
        503,
        "Paid checkout is not configured yet. Set PAYSTACK_SECRET_KEY.",
      );
    }

    const settledNow = !requiresPayment || shouldBypassPaystack;
    let order = null;

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        order = await VendorOrder.create({
          eventId: event._id,
          vendorId: vendor._id,
          vendorUserId: vendor.ownerUserId,
          organizerUserId: event.organizerUserId,
          buyerUserId: actorUserId,
          bookingId: booking._id,
          pickupCode: buildPickupCode(),
          lines,
          note: String(payload.note || "").trim(),
          pricing,
          status: settledNow ? "paid" : "pending_payment",
          paymentProvider: settledNow ? "none" : "paystack",
          paidAt: settledNow ? new Date() : null,
        });
        break;
      } catch (error) {
        /* The unique index is on live orders only, so a clash means tonight
           already has that code. Try another. */
        if (error?.code !== 11000) {
          throw error;
        }
      }
    }

    if (!order) {
      throw new ApiError(500, "Could not allocate a pickup code. Try again.");
    }

    if (settledNow) {
      await notify({
        userId: vendor.ownerUserId,
        type: "vendor.order.new",
        title: `New order ${order.pickupCode}`,
        message: orderSummary(order),
        order,
      });

      return { requiresPayment: false, order: mapOrder(order), payment: null };
    }

    const buyer = await User.findById(actorUserId).select("email");

    try {
      const paymentAttempt = await createPaymentAttemptForCheckout({
        kind: "vendor_order",
        buyerUserId: actorUserId,
        eventId: event._id,
        amountKobo: Math.round(pricing.totalChargedNaira * 100),
        callbackUrl: String(payload.callbackUrl || env.paystackCallbackUrl || ""),
        email: buyer?.email,
        referenceSuffix: String(order._id),
        metadata: {
          vendorOrderId: String(order._id),
          vendorId: String(vendor._id),
          eventId: String(event._id),
        },
      });

      order.paymentAttemptId = paymentAttempt._id;
      order.paymentReference = paymentAttempt.reference;
      await order.save();

      return {
        requiresPayment: true,
        order: mapOrder(order),
        payment: {
          reference: paymentAttempt.reference,
          authorizationUrl: paymentAttempt.authorizationUrl,
          accessCode: paymentAttempt.accessCode,
        },
      };
    } catch (error) {
      /* The order exists but can never be paid for, so it must not sit on
         the vendor's stock. */
      order.status = "cancelled";
      order.cancelledAt = new Date();
      order.cancelReason = "Payment could not be started";
      await order.save();
      throw error;
    }
  } catch (error) {
    await releaseStock(reserved);
    await releaseEventStock({ bookingId: booking._id, lines: eventReserved });
    throw error;
  }
};

/**
 * Confirms a payment and makes the order real to the vendor.
 *
 * Verified against Paystack, never against what the client says it paid.
 */
const verifyOrderPayment = async ({ orderId, actorUserId, reference }) => {
  const order = await VendorOrder.findOne({
    _id: orderId,
    buyerUserId: actorUserId,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.status !== "pending_payment") {
    /* Already settled, by this call or the webhook that beat it. */
    return mapOrder(order);
  }

  const paymentReference = String(
    reference || order.paymentReference || "",
  ).trim();

  if (!paymentReference) {
    throw new ApiError(400, "This order has no payment to verify");
  }

  const paymentData = await verifyPaystackTransaction(paymentReference);

  if (String(paymentData?.status) !== "success") {
    throw new ApiError(409, "That payment has not completed");
  }

  const expectedKobo = Math.round(order.pricing.totalChargedNaira * 100);

  if (Number(paymentData?.amount || 0) < expectedKobo) {
    throw new ApiError(409, "Paid amount is below this order's total", {
      expectedKobo,
    });
  }

  order.status = "paid";
  order.paidAt = new Date();
  order.paymentReference = paymentReference;
  await order.save();

  await notify({
    userId: order.vendorUserId,
    type: "vendor.order.new",
    title: `New order ${order.pickupCode}`,
    message: orderSummary(order),
    order,
  });

  await PaymentAttempt.updateOne(
    { reference: paymentReference },
    { $set: { status: "success", fulfillmentStatus: "fulfilled" } },
  );

  return mapOrder(order);
};

const listMyOrders = async ({ actorUserId, eventId, live }) => {
  const query = { buyerUserId: actorUserId };

  if (eventId) {
    query.eventId = eventId;
  }

  if (live) {
    query.status = { $in: LIVE_STATUSES };
  }

  const orders = await VendorOrder.find(query)
    .populate("vendorId")
    .populate("eventId")
    .sort({ createdAt: -1 })
    .limit(50);

  return {
    items: orders.map((order) =>
      mapOrder(order, { vendor: order.vendorId, event: order.eventId }),
    ),
  };
};

const getMyOrder = async ({ orderId, actorUserId }) => {
  const order = await VendorOrder.findOne({
    _id: orderId,
    buyerUserId: actorUserId,
  })
    .populate("vendorId")
    .populate("eventId");

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  return mapOrder(order, { vendor: order.vendorId, event: order.eventId });
};

/* ----------------------------------------------------------------- vendors */

const listVendorOrders = async ({ actorUserId, eventId, status }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const query = { vendorId: vendor._id };

  if (eventId) {
    query.eventId = eventId;
  }

  /* Unpaid orders are nobody's work yet, so the queue never shows them. */
  query.status = status ? status : { $in: LIVE_STATUSES };

  const orders = await VendorOrder.find(query)
    .populate("eventId")
    .sort({ createdAt: 1 })
    .limit(200);

  const items = orders.map((order) => mapOrder(order, { event: order.eventId }));

  return {
    items,
    counts: {
      paid: items.filter((item) => item.status === "paid").length,
      preparing: items.filter((item) => item.status === "preparing").length,
      ready: items.filter((item) => item.status === "ready").length,
    },
  };
};

const requireOwnOrder = async ({ vendor, orderId }) => {
  const order = await VendorOrder.findOne({
    _id: orderId,
    vendorId: vendor._id,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  return order;
};

/** paid -> preparing -> ready. Forward only, and never past collection. */
const advanceOrder = async ({ orderId, actorUserId, status }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const order = await requireOwnOrder({ vendor, orderId });

  const allowed = { preparing: ["paid"], ready: ["paid", "preparing"] };

  if (!allowed[status]) {
    throw new ApiError(400, "An order cannot be moved to that status");
  }

  if (!allowed[status].includes(order.status)) {
    throw new ApiError(409, `An order that is ${order.status} cannot be marked ${status}`);
  }

  order.status = status;

  if (status === "preparing") {
    order.preparingAt = new Date();
  } else {
    order.readyAt = new Date();
  }

  await order.save();

  if (status === "ready") {
    await notify({
      userId: order.buyerUserId,
      type: "vendor.order.ready",
      title: "Your order is ready",
      message: `Show code ${order.pickupCode} at the stall.`,
      order,
    });
  }

  return mapOrder(order);
};

/**
 * Hands the order over, and only then releases the money.
 *
 * The code is checked here rather than trusted from the screen: it is the one
 * thing standing between an order and somebody else's dinner.
 */
const collectOrder = async ({ orderId, actorUserId, code }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const order = await requireOwnOrder({ vendor, orderId });

  if (order.status === "collected") {
    return mapOrder(order);
  }

  if (!LIVE_STATUSES.includes(order.status)) {
    throw new ApiError(409, "This order cannot be collected");
  }

  if (String(code || "").trim() !== order.pickupCode) {
    throw new ApiError(403, "That pickup code does not match this order", null, "PICKUP_CODE_MISMATCH");
  }

  const event = await Event.findById(order.eventId);

  /* "Events worked" means an event where they actually sold something, so it
     moves on the first order they hand over there and not on every one. */
  const firstAtThisEvent = !(await VendorOrder.exists({
    vendorId: vendor._id,
    eventId: order.eventId,
    status: "collected",
  }));

  const collected = await withMongoTransaction(async (session) => {
    /* Re-read inside the transaction: on a retry, the copy loaded above is
       already "saved" as far as Mongoose is concerned, so its save() would
       write nothing and the order would stay uncollected and uncredited. */
    const fresh = await VendorOrder.findById(order._id).session(session);

    fresh.status = "collected";
    fresh.collectedAt = new Date();
    await fresh.save({ session });

    if (firstAtThisEvent) {
      await Vendor.updateOne(
        { _id: vendor._id },
        { $inc: { eventsWorkedCount: 1 } },
        { session },
      );
    }

    if (env.walletCreditingEnabled) {
      await creditVendorOrder({ order: fresh, event, session });
    }

    return fresh;
  });

  return mapOrder(collected);
};

/**
 * Rates the vendor for one collected order.
 *
 * The averages on a vendor's listing are recomputed here from the ratings
 * themselves rather than nudged, so they can never drift away from the rows
 * that justify them.
 */
const rateOrder = async ({ orderId, actorUserId, rating, comment }) => {
  const order = await VendorOrder.findOne({
    _id: orderId,
    buyerUserId: actorUserId,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.status !== "collected") {
    throw new ApiError(
      409,
      "You can rate an order once you have collected it",
    );
  }

  const existing = await VendorRating.findOne({ orderId: order._id });

  if (existing) {
    throw new ApiError(409, "You have already rated this order");
  }

  await VendorRating.create({
    vendorId: order.vendorId,
    orderId: order._id,
    eventId: order.eventId,
    buyerUserId: actorUserId,
    rating: Math.round(Number(rating)),
    comment: String(comment || "").trim(),
  });

  const [summary] = await VendorRating.aggregate([
    { $match: { vendorId: order.vendorId } },
    {
      $group: {
        _id: "$vendorId",
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  await Vendor.updateOne(
    { _id: order.vendorId },
    {
      $set: {
        averageRating: Math.round((summary?.average || 0) * 10) / 10,
        ratingsCount: summary?.count || 0,
      },
    },
  );

  return {
    orderId: toIdString(order),
    rating: Math.round(Number(rating)),
    vendorAverageRating: Math.round((summary?.average || 0) * 10) / 10,
    vendorRatingsCount: summary?.count || 0,
  };
};

/**
 * Cancels an order and gives the buyer their money back.
 *
 * Safe to do without touching the ledger, because nothing was credited: the
 * hold until collection is exactly what makes a refund this simple.
 */
const cancelOrder = async ({ orderId, actorUserId, reason, byVendor = true }) => {
  let order;

  if (byVendor) {
    const vendor = await requireOwnVendor(actorUserId);
    order = await requireOwnOrder({ vendor, orderId });
  } else {
    order = await VendorOrder.findOne({ _id: orderId, buyerUserId: actorUserId });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    /* A buyer can change their mind right up until the vendor starts
       cooking it, and not after. */
    if (order.status !== "paid") {
      throw new ApiError(
        409,
        order.status === "pending_payment"
          ? "This order has not been paid for"
          : "Your order is already being prepared. Ask the vendor.",
      );
    }
  }

  if (order.status === "collected") {
    throw new ApiError(409, "That order was already handed over");
  }

  if (["cancelled", "refunded"].includes(order.status)) {
    return mapOrder(order);
  }

  const wasPaid = Boolean(order.paidAt) && order.pricing.totalChargedNaira > 0;

  order.status = wasPaid ? "refunded" : "cancelled";
  order.cancelledAt = new Date();
  order.cancelReason = String(reason || "").trim();
  await order.save();

  await releaseStock(order.lines);
  await releaseEventStock({ bookingId: order.bookingId, lines: order.lines });

  if (byVendor) {
    await notify({
      userId: order.buyerUserId,
      type: "vendor.order.cancelled",
      title: "An order was cancelled",
      message: wasPaid
        ? `${order.cancelReason || "The vendor could not make it"}. Your money is on its way back.`
        : order.cancelReason || "The vendor could not make it.",
      order,
    });
  }

  if (wasPaid && order.paymentReference && env.paystackSecretKey) {
    try {
      const refund = await initiatePaystackRefund({
        transactionReference: order.paymentReference,
        amountKobo: Math.round(order.pricing.totalChargedNaira * 100),
      });

      order.refundReference = String(refund?.transaction?.reference || "");
      await order.save();
    } catch (error) {
      /* The order is already cancelled and the buyer told; a refund that the
         provider refused is an operations problem, not a reason to leave the
         order open. */
      console.error(
        "[vendor-order] refund failed:",
        JSON.stringify({
          orderId: toIdString(order),
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return mapOrder(order);
};

/** The vendor's own switch: open or closed, and the wait time buyers see. */
const updateServiceState = async ({ bookingId, actorUserId, payload }) => {
  const vendor = await requireOwnVendor(actorUserId);
  const booking = await EventVendor.findOne({
    _id: bookingId,
    vendorId: vendor._id,
  });

  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }

  if (booking.status !== "confirmed") {
    throw new ApiError(409, "You are not confirmed for this event");
  }

  if (payload.acceptingOrders !== undefined) {
    booking.acceptingOrders = Boolean(payload.acceptingOrders);
  }

  if (payload.prepMinutes !== undefined) {
    booking.prepMinutes =
      payload.prepMinutes === null ? null : Number(payload.prepMinutes);
  }

  if (payload.itemStock !== undefined) {
    const owned = await VendorItem.find({ vendorId: vendor._id }).select("_id");
    const ownedIds = new Set(owned.map((item) => toIdString(item)));
    const rows = (payload.itemStock || []).filter((row) =>
      ownedIds.has(String(row.itemId)),
    );

    if (rows.length !== (payload.itemStock || []).length) {
      throw new ApiError(400, "Those items are not all on your menu");
    }

    booking.itemStock = rows.map((row) => ({
      itemId: row.itemId,
      remaining: Math.max(0, Math.round(Number(row.remaining || 0))),
    }));
  }

  await booking.save();

  return {
    bookingId: toIdString(booking),
    acceptingOrders: booking.acceptingOrders,
    prepMinutes: booking.prepMinutes,
    itemStock: (booking.itemStock || []).map((row) => ({
      itemId: toIdString(row.itemId),
      remaining: row.remaining,
    })),
  };
};

/**
 * Refunds every order still owed to a buyer at an event that was called off.
 *
 * Only orders that were paid for and never handed over: a collected order is
 * food somebody ate, and the vendor has already been credited for it.
 */
const refundOrdersForCancelledEvent = async ({ eventId, reason }) => {
  const orders = await VendorOrder.find({
    eventId,
    status: { $in: ["paid", "preparing", "ready"] },
  }).limit(200);

  let refunded = 0;

  for (const order of orders) {
    try {
      await cancelOrder({
        orderId: order._id,
        actorUserId: order.vendorUserId,
        reason: reason || "Event cancelled",
        byVendor: true,
      });
      refunded += 1;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[vendor-order] cancellation refund failed", {
        orderId: toIdString(order),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return refunded;
};

module.exports = {
  advanceOrder,
  cancelOrder,
  collectOrder,
  getMyOrder,
  getVendorMenuForBuyers,
  listEventVendorsForBuyers,
  listMyOrders,
  listVendorOrders,
  placeOrder,
  rateOrder,
  refundOrdersForCancelledEvent,
  updateServiceState,
  verifyOrderPayment,
};
