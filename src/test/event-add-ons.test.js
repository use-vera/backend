const mongoose = require("mongoose");
const {
  initializeTicketPurchase,
} = require("../services/event.service");
const addOnService = require("../services/event-add-on.service");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/* Free events take the instant-issue path, so a whole checkout can be driven
   without Paystack. The add-on rules under test do not branch on price. */
const sellingEvent = (organizerUserId, addOns) =>
  createEvent({
    organizerUserId,
    isPaid: false,
    ticketPriceNaira: 0,
    expectedTickets: 100,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 54 * HOUR_MS),
    addOns,
  });

const addOn = (overrides) => ({
  _id: new mongoose.Types.ObjectId(),
  name: "Parking",
  priceNaira: 5000,
  redemption: "door",
  stock: 10,
  variants: [],
  maxPerTicket: 1,
  transfersOnResale: true,
  active: true,
  ...overrides,
});

const buy = ({ event, buyer, addOns = [], quantity = 1 }) =>
  initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { quantity, email: "buyer@example.com", addOns },
  });

test("an add-on bought with a ticket is held against that ticket", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = addOn({});
  const event = await sellingEvent(organizer._id, [parking]);

  const result = await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(parking._id), quantity: 1 }],
  });

  const held = await EventAddOnPurchase.find({ ticketId: result.ticket._id });

  expect(held).toHaveLength(1);
  expect(held[0].name).toBe("Parking");
  expect(held[0].status).toBe("paid");
  // Snapshotted, so editing the event later cannot change what was bought.
  expect(held[0].unitPriceNaira).toBe(5000);
  expect(held[0].redemption).toBe("door");
});

test("stock is per variant, and a sold-out option is refused", async () => {
  const organizer = await createUser();
  const first = await createUser();
  const second = await createUser();

  const shirt = addOn({
    name: "T-shirt",
    priceNaira: 15000,
    redemption: "desk",
    stock: 0,
    variants: [
      { _id: new mongoose.Types.ObjectId(), name: "M", stock: 1 },
      { _id: new mongoose.Types.ObjectId(), name: "L", stock: 5 },
    ],
  });
  const event = await sellingEvent(organizer._id, [shirt]);

  await buy({
    event,
    buyer: first,
    addOns: [{ addOnId: String(shirt._id), variantName: "M", quantity: 1 }],
  });

  // The only medium is gone...
  await expect(
    buy({
      event,
      buyer: second,
      addOns: [{ addOnId: String(shirt._id), variantName: "M", quantity: 1 }],
    }),
  ).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_INVENTORY" });

  // ...but larges are untouched, which is the whole point of per-variant stock.
  const large = await buy({
    event,
    buyer: second,
    addOns: [{ addOnId: String(shirt._id), variantName: "L", quantity: 1 }],
  });

  expect(large.ticket).toBeDefined();
});

test("an add-on with options cannot be bought without choosing one", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const shirt = addOn({
    name: "T-shirt",
    stock: 0,
    variants: [{ _id: new mongoose.Types.ObjectId(), name: "M", stock: 5 }],
  });
  const event = await sellingEvent(organizer._id, [shirt]);

  await expect(
    buy({ event, buyer, addOns: [{ addOnId: String(shirt._id), quantity: 1 }] }),
  ).rejects.toMatchObject({ statusCode: 400 });
});

test("maxPerTicket is enforced against the number of tickets bought", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = addOn({ stock: 50, maxPerTicket: 1 });
  const event = await sellingEvent(organizer._id, [parking]);

  // One ticket allows one parking space.
  await expect(
    buy({
      event,
      buyer,
      quantity: 1,
      addOns: [{ addOnId: String(parking._id), quantity: 2 }],
    }),
  ).rejects.toMatchObject({ statusCode: 400 });

  // Three tickets allow three.
  const result = await buy({
    event,
    buyer,
    quantity: 3,
    addOns: [{ addOnId: String(parking._id), quantity: 3 }],
  });

  expect(result.ticket).toBeDefined();
});

test("each add-on redeems on its own, and only once", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = addOn({});
  const dinner = addOn({
    _id: new mongoose.Types.ObjectId(),
    name: "Dinner",
    priceNaira: 20000,
    redemption: "desk",
  });
  const event = await sellingEvent(organizer._id, [parking, dinner]);

  const result = await buy({
    event,
    buyer,
    addOns: [
      { addOnId: String(parking._id), quantity: 1 },
      { addOnId: String(dinner._id), quantity: 1 },
    ],
  });

  const held = await addOnService.listTicketAddOns({ ticketId: result.ticket._id });
  const parkingRow = held.find((row) => row.name === "Parking");

  const redeemed = await addOnService.redeemAddOn({
    purchaseId: parkingRow._id,
    actorUserId: organizer._id,
  });

  expect(redeemed.status).toBe("redeemed");

  // A second scan of the same item is refused...
  await expect(
    addOnService.redeemAddOn({
      purchaseId: parkingRow._id,
      actorUserId: organizer._id,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });

  // ...and spending parking has not spent the dinner.
  const stillHeld = await addOnService.listTicketAddOns({
    ticketId: result.ticket._id,
  });
  const dinnerRow = stillHeld.find((row) => row.name === "Dinner");

  expect(dinnerRow.status).toBe("paid");
  expect(dinnerRow.redeemedQuantity).toBe(0);
});

test("the organizer is credited for add-ons separately from the ticket", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const dinner = addOn({ name: "Dinner", priceNaira: 20000, redemption: "desk" });
  const event = await sellingEvent(organizer._id, [dinner]);

  const result = await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(dinner._id), quantity: 1 }],
  });

  const addOnCredits = await WalletTransaction.find({
    organizerUserId: organizer._id,
    type: "add_on_sale",
  });

  expect(addOnCredits).toHaveLength(1);
  // Its own ledger row, keyed to the purchase rather than the ticket, so a
  // ticket refund cannot reverse the wrong amount.
  expect(addOnCredits[0].metadata.addOnName).toBe("Dinner");
  expect(addOnCredits[0].ticketId.toString()).toBe(String(result.ticket._id));
});

test("availability reports what is left, per option", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const shirt = addOn({
    name: "T-shirt",
    stock: 0,
    variants: [
      { _id: new mongoose.Types.ObjectId(), name: "M", stock: 3 },
      { _id: new mongoose.Types.ObjectId(), name: "L", stock: 2 },
    ],
  });
  const event = await sellingEvent(organizer._id, [shirt]);

  await buy({
    event,
    buyer,
    addOns: [{ addOnId: String(shirt._id), variantName: "M", quantity: 1 }],
  });

  const [described] = await addOnService.listPublicAddOns({ event });
  const medium = described.variants.find((variant) => variant.name === "M");

  expect(medium.remaining).toBe(2);
  expect(described.remaining).toBe(4);
  expect(described.soldOut).toBe(false);
});

/* HTTP coverage, not just the service: a controller that imports the wrong
   helper name still passes every unit test above and 500s in production. */
describe("over HTTP", () => {
  const request = require("supertest");
  const app = require("../app");
  const { signAccessToken } = require("../utils/jwt");

  const tokenFor = (user) => signAccessToken({ userId: String(user._id) });

  test("a door hands an add-on over, and cannot do it twice", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const parking = addOn({});
    const event = await sellingEvent(organizer._id, [parking]);

    const order = await buy({
      event,
      buyer,
      addOns: [{ addOnId: String(parking._id), quantity: 1 }],
    });
    const [held] = await addOnService.listTicketAddOns({
      ticketId: order.ticket._id,
    });

    const first = await request(app)
      .post(`/api/events/${event._id}/add-ons/${held._id}/redeem`)
      .set("Authorization", `Bearer ${tokenFor(organizer)}`);

    if (first.status !== 200) {
      console.error("REDEEM FAILED", first.status, first.body);
    }

    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("redeemed");

    const second = await request(app)
      .post(`/api/events/${event._id}/add-ons/${held._id}/redeem`)
      .set("Authorization", `Bearer ${tokenFor(organizer)}`);

    expect(second.status).toBe(409);
  });

  test("someone else's event cannot redeem this one's stock", async () => {
    const organizer = await createUser();
    const stranger = await createUser();
    const buyer = await createUser();
    const parking = addOn({});
    const event = await sellingEvent(organizer._id, [parking]);

    const order = await buy({
      event,
      buyer,
      addOns: [{ addOnId: String(parking._id), quantity: 1 }],
    });
    const [held] = await addOnService.listTicketAddOns({
      ticketId: order.ticket._id,
    });

    const response = await request(app)
      .post(`/api/events/${event._id}/add-ons/${held._id}/redeem`)
      .set("Authorization", `Bearer ${tokenFor(stranger)}`);

    expect([403, 404]).toContain(response.status);
  });

  test("the desk's list says what is still owed", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const shirt = addOn({
      name: "T-shirt",
      redemption: "desk",
      stock: 0,
      variants: [{ _id: new mongoose.Types.ObjectId(), name: "M", stock: 5 }],
    });
    const event = await sellingEvent(organizer._id, [shirt]);

    await buy({
      event,
      buyer,
      addOns: [{ addOnId: String(shirt._id), variantName: "M", quantity: 1 }],
    });

    const response = await request(app)
      .get(`/api/events/${event._id}/add-ons/fulfilment?redemption=desk`)
      .set("Authorization", `Bearer ${tokenFor(organizer)}`);

    if (response.status !== 200) {
      console.error("FULFILMENT FAILED", response.status, response.body);
    }

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        name: "T-shirt",
        variantName: "M",
        sold: 1,
        collected: 0,
        outstanding: 1,
      }),
    ]);
  });
});

describe("refunds", () => {
  const { refundTicketAddOns } = require("../services/refund.service");
  const OrganizerWallet = require("../models/organizer-wallet.model");

  test("refunding an add-on reverses its own credit, not the ticket's", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const dinner = addOn({ name: "Dinner", priceNaira: 20000, redemption: "desk" });
    const event = await sellingEvent(organizer._id, [dinner]);

    const order = await buy({
      event,
      buyer,
      addOns: [{ addOnId: String(dinner._id), quantity: 1 }],
    });

    const before = await OrganizerWallet.findOne({ organizerUserId: organizer._id });
    const creditedKobo = before.pendingBalanceKobo;

    const refunded = await refundTicketAddOns({
      ticketId: order.ticket._id,
      reason: "Event cancelled",
    });

    expect(refunded).toHaveLength(1);

    const after = await OrganizerWallet.findOne({ organizerUserId: organizer._id });

    // The credit is the NET of Vera's 5%, so ₦19,000 went in and ₦19,000
    // comes back out. The ticket was free, so the wallet returns to zero.
    expect(creditedKobo).toBe(19000 * 100);
    expect(after.pendingBalanceKobo).toBe(0);

    const row = await EventAddOnPurchase.findById(refunded[0]._id);
    expect(row.status).toBe("refunded");
  });

  test("a refunded add-on releases its stock and cannot be refunded twice", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const other = await createUser();
    const parking = addOn({ stock: 1 });
    const event = await sellingEvent(organizer._id, [parking]);

    const order = await buy({
      event,
      buyer,
      addOns: [{ addOnId: String(parking._id), quantity: 1 }],
    });

    await refundTicketAddOns({ ticketId: order.ticket._id, reason: "Cancelled" });

    // A second sweep finds nothing left to reverse.
    const again = await refundTicketAddOns({
      ticketId: order.ticket._id,
      reason: "Cancelled",
    });
    expect(again).toHaveLength(0);

    // And the space is back on sale.
    const resold = await buy({
      event,
      buyer: other,
      addOns: [{ addOnId: String(parking._id), quantity: 1 }],
    });
    expect(resold.ticket).toBeDefined();
  });

  test("only add-ons the organizer marked non-transferable are refunded on resale", async () => {
    const organizer = await createUser();
    const buyer = await createUser();
    const parking = addOn({ transfersOnResale: true });
    const shirt = addOn({
      _id: new mongoose.Types.ObjectId(),
      name: "T-shirt",
      redemption: "desk",
      transfersOnResale: false,
    });
    const event = await sellingEvent(organizer._id, [parking, shirt]);

    const order = await buy({
      event,
      buyer,
      addOns: [
        { addOnId: String(parking._id), quantity: 1 },
        { addOnId: String(shirt._id), quantity: 1 },
      ],
    });

    const refunded = await refundTicketAddOns({
      ticketId: order.ticket._id,
      reason: "Ticket resold",
      onlyNonTransferable: true,
    });

    expect(refunded.map((row) => row.name)).toEqual(["T-shirt"]);

    const stillHeld = await addOnService.listTicketAddOns({
      ticketId: order.ticket._id,
    });
    expect(stillHeld.map((row) => row.name)).toEqual(["Parking"]);
  });
});
