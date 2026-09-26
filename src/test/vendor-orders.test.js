/* Ordering, end to end, with the money rules pinned.
   The one that matters most: nothing reaches a wallet until collection. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_vendor_orders";
process.env.PAYSTACK_DEV_BYPASS = "false";

jest.mock("../services/notification.service", () => ({
  ...jest.requireActual("../services/notification.service"),
  createNotification: jest.fn().mockResolvedValue(null),
}));

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
  initiatePaystackRefund: jest
    .fn()
    .mockResolvedValue({ transaction: { reference: "refund_ref" } }),
}));

const vendorOrderService = require("../services/vendor-order.service");
const vendorService = require("../services/vendor.service");
const eventVendorService = require("../services/event-vendor.service");
const {
  initiatePaystackRefund,
  verifyPaystackTransaction,
} = require("../services/paystack.service");
const VendorItem = require("../models/vendor-item.model");
const VendorOrder = require("../models/vendor-order.model");
const Vendor = require("../models/vendor.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const Event = require("../models/event.model");
const { createNotification } = require("../services/notification.service");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/** An event, a confirmed vendor with one item, and a ticket-holding buyer. */
const stallAtAnEvent = async ({ stock = null } = {}) => {
  const organizer = await createUser();
  const vendorOwner = await createUser();
  const buyer = await createUser();

  const event = await createEvent({
    organizerUserId: organizer._id,
    /* Under way: orders are only taken while an event is live. */
    startsAt: new Date(Date.now() - HOUR_MS),
    endsAt: new Date(Date.now() + 6 * HOUR_MS),
    vendorSettings: {
      acceptingApplications: true,
      stallFeeNaira: 0,
      spots: 0,
    },
  });

  const vendor = await vendorService.createVendor({
    actorUserId: vendorOwner._id,
    payload: { businessName: "Mama Put Express", categories: ["food"] },
  });

  const invite = await eventVendorService.inviteVendor({
    eventId: event._id,
    actorUserId: organizer._id,
    payload: { vendorId: vendor._id, terms: { stallLabel: "Stall 7" } },
  });
  await eventVendorService.respondToInvite({
    bookingId: invite._id,
    actorUserId: vendorOwner._id,
    accept: true,
  });

  const item = await vendorService.createItem({
    actorUserId: vendorOwner._id,
    payload: {
      name: "Jollof rice & chicken",
      category: "food",
      priceNaira: 4000,
      stock,
    },
  });

  /* Ordering is for people who are actually coming. */
  await createPaidTicket({ event, buyerUserId: buyer._id });

  return { organizer, vendorOwner, vendor, buyer, event, item, bookingId: invite._id };
};

const order = ({ event, vendor, buyer, item, quantity = 1, note }) =>
  vendorOrderService.placeOrder({
    eventId: event._id,
    vendorId: vendor._id,
    actorUserId: buyer._id,
    payload: { items: [{ itemId: item._id, quantity }], note },
  });

/** Drives a placed order through Paystack to paid. */
const pay = async ({ placed, buyer }) => {
  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: placed.order.pricing.totalChargedNaira * 100,
  });

  return vendorOrderService.verifyOrderPayment({
    orderId: placed.order._id,
    actorUserId: buyer._id,
    reference: placed.payment.reference,
  });
};

const walletRows = (userId) =>
  WalletTransaction.find({ organizerUserId: userId });

beforeEach(() => {
  verifyPaystackTransaction.mockReset();
  initiatePaystackRefund.mockClear();
});

describe("placing an order", () => {
  test("an order is priced, held, and given a pickup code", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order({ ...stall, quantity: 2 });

    expect(placed.requiresPayment).toBe(true);
    expect(placed.payment.authorizationUrl).toBeTruthy();
    expect(placed.order.status).toBe("pending_payment");
    expect(placed.order.pickupCode).toMatch(/^\d{4}$/);

    // 2 × ₦4,000. Vera takes 5%, the vendor keeps the rest. The organizer
    // earns from the stall fee alone, so nothing comes off here for them.
    expect(placed.order.pricing.subtotalNaira).toBe(8000);
    expect(placed.order.pricing.totalChargedNaira).toBe(8000);
    expect(placed.order.pricing.veraFeeNaira).toBe(400);
    expect(placed.order.pricing.vendorNetNaira).toBe(7600);
  });

  test("the split always adds back up to the subtotal", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order({ ...stall, quantity: 3 });
    const { subtotalNaira, veraFeeNaira, vendorNetNaira } = placed.order.pricing;

    expect(veraFeeNaira + vendorNetNaira).toBe(subtotalNaira);
  });

  test("someone without a ticket cannot order", async () => {
    const stall = await stallAtAnEvent();
    const stranger = await createUser();

    await expect(
      order({ ...stall, buyer: stranger }),
    ).rejects.toMatchObject({ statusCode: 403, code: "TICKET_REQUIRED" });
  });

  test("a paused vendor takes no new orders", async () => {
    const stall = await stallAtAnEvent();

    await vendorOrderService.updateServiceState({
      bookingId: stall.bookingId,
      actorUserId: stall.vendorOwner._id,
      payload: { acceptingOrders: false, prepMinutes: 12 },
    });

    await expect(order(stall)).rejects.toMatchObject({ statusCode: 409 });
  });

  test("stock is taken when the order is placed, and cannot go below zero", async () => {
    const stall = await stallAtAnEvent({ stock: 2 });

    await order({ ...stall, quantity: 2 });

    const afterFirst = await VendorItem.findById(stall.item._id);
    expect(afterFirst.stock).toBe(0);

    await expect(order(stall)).rejects.toMatchObject({
      code: "ITEM_UNAVAILABLE",
    });
  });

  test("an unlimited item is not accidentally given a stock count", async () => {
    const stall = await stallAtAnEvent({ stock: null });

    await order({ ...stall, quantity: 5 });

    const item = await VendorItem.findById(stall.item._id);
    expect(item.stock).toBeNull();
  });
});

describe("paying and preparing", () => {
  test("a verified payment makes the order the vendor's work", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    const paid = await pay({ placed, buyer: stall.buyer });

    expect(paid.status).toBe("paid");

    const queue = await vendorOrderService.listVendorOrders({
      actorUserId: stall.vendorOwner._id,
    });
    expect(queue.items).toHaveLength(1);
    expect(queue.counts.paid).toBe(1);
  });

  test("an unpaid order never reaches the vendor's queue", async () => {
    const stall = await stallAtAnEvent();
    await order(stall);

    const queue = await vendorOrderService.listVendorOrders({
      actorUserId: stall.vendorOwner._id,
    });
    expect(queue.items).toHaveLength(0);
  });

  test("a payment below the total is refused", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);

    verifyPaystackTransaction.mockResolvedValueOnce({
      status: "success",
      amount: 100,
    });

    await expect(
      vendorOrderService.verifyOrderPayment({
        orderId: placed.order._id,
        actorUserId: stall.buyer._id,
        reference: placed.payment.reference,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("orders move forward only", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });

    const preparing = await vendorOrderService.advanceOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "preparing",
    });
    expect(preparing.status).toBe("preparing");

    await vendorOrderService.advanceOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "ready",
    });

    await expect(
      vendorOrderService.advanceOrder({
        orderId: placed.order._id,
        actorUserId: stall.vendorOwner._id,
        status: "preparing",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("one vendor cannot touch another vendor's order", async () => {
    const stall = await stallAtAnEvent();
    const other = await createUser();
    await vendorService.createVendor({
      actorUserId: other._id,
      payload: { businessName: "Suya Spot", categories: ["food"] },
    });

    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });

    await expect(
      vendorOrderService.advanceOrder({
        orderId: placed.order._id,
        actorUserId: other._id,
        status: "preparing",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("handing over is what releases the money", () => {
  test("nothing is credited until the order is collected", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });
    await vendorOrderService.advanceOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "ready",
    });

    // Paid, prepared, ready, and still nobody has been paid.
    expect(await walletRows(stall.vendorOwner._id)).toHaveLength(0);
    expect(await walletRows(stall.organizer._id)).toHaveLength(0);

    await vendorOrderService.collectOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      code: placed.order.pickupCode,
    });

    const vendorRows = await walletRows(stall.vendorOwner._id);
    const sale = vendorRows.find((row) => row.type === "vendor_order_sale");
    // ₦4,000 less Vera's 5%.
    expect(sale.amountKobo).toBe(3800 * 100);
    expect(sale.status).toBe("pending_settlement");

    // The organizer's money is the stall fee, not a cut of this.
    expect(await walletRows(stall.organizer._id)).toHaveLength(0);
  });

  test("the wrong pickup code hands nothing over", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });

    const wrong = placed.order.pickupCode === "1111" ? "2222" : "1111";

    await expect(
      vendorOrderService.collectOrder({
        orderId: placed.order._id,
        actorUserId: stall.vendorOwner._id,
        code: wrong,
      }),
    ).rejects.toMatchObject({ code: "PICKUP_CODE_MISMATCH" });

    const stored = await VendorOrder.findById(placed.order._id);
    expect(stored.status).toBe("paid");
    expect(await walletRows(stall.vendorOwner._id)).toHaveLength(0);
  });

  test("collecting twice credits once", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });

    const collect = () =>
      vendorOrderService.collectOrder({
        orderId: placed.order._id,
        actorUserId: stall.vendorOwner._id,
        code: placed.order.pickupCode,
      });

    await collect();
    await collect();

    const sales = (await walletRows(stall.vendorOwner._id)).filter(
      (row) => row.type === "vendor_order_sale",
    );
    expect(sales).toHaveLength(1);
  });
});

describe("cancelling", () => {
  test("a vendor cancelling a paid order refunds it and puts the stock back", async () => {
    const stall = await stallAtAnEvent({ stock: 10 });
    const placed = await order({ ...stall, quantity: 3 });
    await pay({ placed, buyer: stall.buyer });

    const cancelled = await vendorOrderService.cancelOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      reason: "Ran out of chicken",
      byVendor: true,
    });

    expect(cancelled.status).toBe("refunded");
    expect(initiatePaystackRefund).toHaveBeenCalledWith({
      transactionReference: placed.payment.reference,
      amountKobo: 12000 * 100,
    });

    const item = await VendorItem.findById(stall.item._id);
    expect(item.stock).toBe(10);

    // Refunded money was never credited, so there is nothing to reverse.
    expect(await walletRows(stall.vendorOwner._id)).toHaveLength(0);
  });

  test("a collected order cannot be cancelled", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });
    await vendorOrderService.collectOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      code: placed.order.pickupCode,
    });

    await expect(
      vendorOrderService.cancelOrder({
        orderId: placed.order._id,
        actorUserId: stall.vendorOwner._id,
        byVendor: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("a buyer can cancel before cooking starts, but not after", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });

    const second = await order(stall);
    await pay({ placed: second, buyer: stall.buyer });
    await vendorOrderService.advanceOrder({
      orderId: second.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "preparing",
    });

    const cancelled = await vendorOrderService.cancelOrder({
      orderId: placed.order._id,
      actorUserId: stall.buyer._id,
      byVendor: false,
    });
    expect(cancelled.status).toBe("refunded");

    await expect(
      vendorOrderService.cancelOrder({
        orderId: second.order._id,
        actorUserId: stall.buyer._id,
        byVendor: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("what buyers see", () => {
  test("the event lists vendors who are selling, with their wait time", async () => {
    const stall = await stallAtAnEvent();

    await vendorOrderService.updateServiceState({
      bookingId: stall.bookingId,
      actorUserId: stall.vendorOwner._id,
      payload: { prepMinutes: 12 },
    });

    const list = await vendorOrderService.listEventVendorsForBuyers({
      eventId: stall.event._id,
      actorUserId: stall.buyer._id,
    });

    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      businessName: "Mama Put Express",
      stallLabel: "Stall 7",
      prepMinutes: 12,
      acceptingOrders: true,
    });
  });

  test("a switched-off item is not on the buyer's menu", async () => {
    const stall = await stallAtAnEvent();

    await vendorService.updateItem({
      actorUserId: stall.vendorOwner._id,
      itemId: stall.item._id,
      payload: { available: false },
    });

    const menu = await vendorOrderService.getVendorMenuForBuyers({
      eventId: stall.event._id,
      vendorId: stall.vendor._id,
      actorUserId: stall.buyer._id,
    });

    expect(menu.sections).toHaveLength(0);
  });

  test("a buyer sees their own order and its code", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order({ ...stall, note: "No pepper" });
    await pay({ placed, buyer: stall.buyer });

    const mine = await vendorOrderService.listMyOrders({
      actorUserId: stall.buyer._id,
      live: true,
    });

    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].note).toBe("No pepper");
    expect(mine.items[0].vendor.businessName).toBe("Mama Put Express");
    expect(mine.items[0].pickupCode).toMatch(/^\d{4}$/);
  });
});

describe("ratings and events worked", () => {
  const collect = async (stall) => {
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });
    await vendorOrderService.collectOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      code: placed.order.pickupCode,
    });

    return placed;
  };

  test("a rating moves the vendor's average, and only after collection", async () => {
    const stall = await stallAtAnEvent();

    const notCollected = await order(stall);
    await pay({ placed: notCollected, buyer: stall.buyer });

    await expect(
      vendorOrderService.rateOrder({
        orderId: notCollected.order._id,
        actorUserId: stall.buyer._id,
        rating: 5,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const placed = await collect(stall);
    const rated = await vendorOrderService.rateOrder({
      orderId: placed.order._id,
      actorUserId: stall.buyer._id,
      rating: 4,
      comment: "Hot and fast",
    });

    expect(rated.vendorAverageRating).toBe(4);
    expect(rated.vendorRatingsCount).toBe(1);

    const vendor = await Vendor.findById(stall.vendor._id);
    expect(vendor.averageRating).toBe(4);
    expect(vendor.ratingsCount).toBe(1);
  });

  test("an order can only be rated once", async () => {
    const stall = await stallAtAnEvent();
    const placed = await collect(stall);

    await vendorOrderService.rateOrder({
      orderId: placed.order._id,
      actorUserId: stall.buyer._id,
      rating: 5,
    });

    await expect(
      vendorOrderService.rateOrder({
        orderId: placed.order._id,
        actorUserId: stall.buyer._id,
        rating: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("events worked counts events, not orders", async () => {
    const stall = await stallAtAnEvent();

    await collect(stall);
    await collect(stall);

    const vendor = await Vendor.findById(stall.vendor._id);
    expect(vendor.eventsWorkedCount).toBe(1);
  });
});

describe("stock for tonight", () => {
  test("a count set for the event beats the item's own", async () => {
    const stall = await stallAtAnEvent({ stock: 100 });

    await vendorOrderService.updateServiceState({
      bookingId: stall.bookingId,
      actorUserId: stall.vendorOwner._id,
      payload: { itemStock: [{ itemId: stall.item._id, remaining: 2 }] },
    });

    const menu = await vendorOrderService.getVendorMenuForBuyers({
      eventId: stall.event._id,
      vendorId: stall.vendor._id,
      actorUserId: stall.buyer._id,
    });
    expect(menu.sections[0].items[0].stock).toBe(2);

    await order({ ...stall, quantity: 2 });

    // Tonight is finished, even though the item itself has 100 on paper.
    await expect(order(stall)).rejects.toMatchObject({
      code: "ITEM_UNAVAILABLE",
    });

    const item = await VendorItem.findById(stall.item._id);
    expect(item.stock).toBe(100);
  });

  test("cancelling puts tonight's count back", async () => {
    const stall = await stallAtAnEvent({ stock: null });

    await vendorOrderService.updateServiceState({
      bookingId: stall.bookingId,
      actorUserId: stall.vendorOwner._id,
      payload: { itemStock: [{ itemId: stall.item._id, remaining: 5 }] },
    });

    const placed = await order({ ...stall, quantity: 3 });
    await pay({ placed, buyer: stall.buyer });

    await vendorOrderService.cancelOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      byVendor: true,
    });

    const menu = await vendorOrderService.getVendorMenuForBuyers({
      eventId: stall.event._id,
      vendorId: stall.vendor._id,
      actorUserId: stall.buyer._id,
    });
    expect(menu.sections[0].items[0].stock).toBe(5);
  });

  test("a vendor cannot set counts for someone else's item", async () => {
    const stall = await stallAtAnEvent();
    const other = await createUser();
    const otherVendor = await vendorService.createVendor({
      actorUserId: other._id,
      payload: { businessName: "Suya Spot", categories: ["food"] },
    });
    const theirItem = await vendorService.createItem({
      actorUserId: other._id,
      payload: { name: "Suya", category: "food", priceNaira: 2000 },
    });

    await expect(
      vendorOrderService.updateServiceState({
        bookingId: stall.bookingId,
        actorUserId: stall.vendorOwner._id,
        payload: { itemStock: [{ itemId: theirItem._id, remaining: 3 }] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(otherVendor.businessName).toBe("Suya Spot");
  });
});

describe("only while the event is on", () => {
  const eventAt = async (startsAt, endsAt) => {
    const context = await stallAtAnEvent();

    await Event.updateOne(
      { _id: context.event._id },
      { $set: { startsAt, endsAt } },
    );

    return context;
  };

  test("an event that has not started takes no orders, and shows no one as open", async () => {
    const context = await eventAt(
      new Date(Date.now() + 3 * HOUR_MS),
      new Date(Date.now() + 9 * HOUR_MS),
    );

    await expect(order(context)).rejects.toMatchObject({
      statusCode: 409,
      code: "EVENT_NOT_LIVE",
    });

    /* Vendors are still listed: you can see who will be there. They are just
       nobody you can order from yet. */
    const list = await vendorOrderService.listEventVendorsForBuyers({
      eventId: context.event._id,
      actorUserId: context.buyer._id,
    });

    expect(list.items).toHaveLength(1);
    expect(list.items[0].acceptingOrders).toBe(false);
    expect(list.event.live).toBe(false);
  });

  test("an event that has ended takes no orders", async () => {
    const context = await eventAt(
      new Date(Date.now() - 9 * HOUR_MS),
      new Date(Date.now() - 3 * HOUR_MS),
    );

    await expect(order(context)).rejects.toMatchObject({
      code: "EVENT_NOT_LIVE",
    });
  });

  test("a live event takes them, and says so", async () => {
    const context = await stallAtAnEvent();

    const list = await vendorOrderService.listEventVendorsForBuyers({
      eventId: context.event._id,
      actorUserId: context.buyer._id,
    });
    expect(list.event.live).toBe(true);
    expect(list.items[0].acceptingOrders).toBe(true);

    const placed = await order(context);
    expect(placed.order.status).toBe("pending_payment");
  });

  test("a vendor's menu shows them closed before the doors open", async () => {
    const context = await eventAt(
      new Date(Date.now() + 3 * HOUR_MS),
      new Date(Date.now() + 9 * HOUR_MS),
    );

    const menu = await vendorOrderService.getVendorMenuForBuyers({
      eventId: context.event._id,
      vendorId: context.vendor._id,
      actorUserId: context.buyer._id,
    });

    expect(menu.event.live).toBe(false);
    expect(menu.vendor.acceptingOrders).toBe(false);
  });
});

describe("telling people, without anyone watching a screen", () => {
  const notifiedWith = (type) =>
    createNotification.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.type === type);

  beforeEach(() => {
    createNotification.mockClear();
  });

  test("a paid order reaches the vendor", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);

    /* Not before it is paid for: an abandoned checkout is not an order. */
    expect(notifiedWith("vendor.order.new")).toHaveLength(0);

    await pay({ placed, buyer: stall.buyer });

    const sent = notifiedWith("vendor.order.new");
    expect(sent).toHaveLength(1);
    expect(String(sent[0].userId)).toBe(String(stall.vendorOwner._id));
    expect(sent[0].title).toContain(placed.order.pickupCode);
  });

  test("marking an order ready reaches the buyer", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });
    createNotification.mockClear();

    await vendorOrderService.advanceOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "preparing",
    });
    expect(notifiedWith("vendor.order.ready")).toHaveLength(0);

    await vendorOrderService.advanceOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      status: "ready",
    });

    const sent = notifiedWith("vendor.order.ready");
    expect(sent).toHaveLength(1);
    expect(String(sent[0].userId)).toBe(String(stall.buyer._id));
    expect(sent[0].message).toContain(placed.order.pickupCode);
  });

  test("a vendor cancelling tells the buyer their money is coming back", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    await pay({ placed, buyer: stall.buyer });
    createNotification.mockClear();

    await vendorOrderService.cancelOrder({
      orderId: placed.order._id,
      actorUserId: stall.vendorOwner._id,
      reason: "Ran out of chicken",
      byVendor: true,
    });

    const sent = notifiedWith("vendor.order.cancelled");
    expect(sent).toHaveLength(1);
    expect(String(sent[0].userId)).toBe(String(stall.buyer._id));
    expect(sent[0].message).toContain("Ran out of chicken");
  });

  test("a failed notification never fails the order", async () => {
    const stall = await stallAtAnEvent();
    const placed = await order(stall);
    createNotification.mockRejectedValueOnce(new Error("push is down"));

    await expect(pay({ placed, buyer: stall.buyer })).resolves.toMatchObject({
      status: "paid",
    });
  });
});
