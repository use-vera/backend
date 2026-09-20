jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn().mockResolvedValue({
    status: "success",
    amount: 0,
  }),
}));

const mongoose = require("mongoose");
const {
  initializeTicketPurchase,
  verifyTicketPayment,
  previewEventPromoCode,
  listEventPromoCodes,
  listAvailablePromoCodes,
  createTicketResale,
} = require("../services/event.service");
const { verifyPaystackTransaction } = require("../services/paystack.service");
const EventTicket = require("../models/event-ticket.model");
const EventAddOnPurchase = require("../models/event-add-on-purchase.model");
const PromoCodeRedemption = require("../models/promo-code-redemption.model");
const WalletTransaction = require("../models/wallet-transaction.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const promoCode = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: "Early bird",
  code: "EARLY10",
  discountType: "percent",
  discountValue: 10,
  appliesTo: "ticket",
  maxUses: 0,
  perUserLimit: 1,
  endsAt: null,
  active: true,
  ...overrides,
});

const addOn = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: "Parking",
  priceNaira: 5000,
  redemption: "door",
  stock: 20,
  variants: [],
  maxPerTicket: 2,
  transfersOnResale: true,
  active: true,
  ...overrides,
});

/** A ₦50,000 ticket, so a 10% code is a round ₦5,000 off. */
const sellingEvent = ({ organizerUserId, promoCodes = [], addOns = [] }) =>
  createEvent({
    organizerUserId,
    isPaid: true,
    ticketPriceNaira: 50000,
    platformFeePercent: 5,
    feeMode: "absorbed_by_organizer",
    expectedTickets: 100,
    startsAt: new Date(Date.now() + 48 * HOUR_MS),
    endsAt: new Date(Date.now() + 54 * HOUR_MS),
    promoCodes,
    addOns,
  });

const buy = ({ event, buyer, promo, addOns = [], quantity = 1 }) =>
  initializeTicketPurchase({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: {
      quantity,
      email: "buyer@example.com",
      ...(promo ? { promoCode: promo } : {}),
      addOns,
    },
  });

/** Drives the order all the way to settled money. */
const settle = async ({ result, buyer }) => {
  const charged = Number(
    result.payment?.paystackInitializePayload?.amount ||
      result.pricingBreakdown.totalCheckoutNaira * 100,
  );

  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: charged,
  });

  return verifyTicketPayment({
    ticketId: result.ticket._id,
    actorUserId: buyer._id,
    reference: result.payment?.reference || "mock_reference",
  });
};

const creditedToOrganizer = async (organizerUserId) => {
  const rows = await WalletTransaction.find({
    organizerUserId,
    type: { $in: ["ticket_sale", "add_on_sale"] },
  });

  return rows.reduce((sum, row) => sum + row.amountKobo, 0) / 100;
};

test("a ticket code takes the discount off the buyer's total and the organizer's payout, never off Vera's fee", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode()],
  });

  const result = await buy({ event, buyer, promo: "early10" });

  // The buyer is charged ₦45,000 rather than ₦50,000.
  expect(result.pricingBreakdown.totalCheckoutNaira).toBe(45000);
  // Vera's 5% is still worked out on the full ₦50,000: a code costs Vera nothing.
  expect(result.pricingBreakdown.veraFeeNaira).toBe(2500);
  // Which leaves the discount squarely with the organizer: ₦47,500 becomes ₦42,500.
  expect(result.pricingBreakdown.organizerNetNaira).toBe(42500);

  await settle({ result, buyer });

  // The organizer's credit is already net of Vera's fee: ₦45,000 paid, less
  // ₦2,500 of fee, is the ₦42,500 that lands in their wallet.
  expect(await creditedToOrganizer(organizer._id)).toBe(42500);
});

test("the code is only spent once the payment settles", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode()],
  });

  const result = await buy({ event, buyer, promo: "EARLY10" });

  const held = await PromoCodeRedemption.findOne({
    purchaseBatchId: result.purchaseBatchId,
  });
  expect(held.status).toBe("reserved");
  expect(held.discountNaira).toBe(5000);

  await settle({ result, buyer });

  const spent = await PromoCodeRedemption.findById(held._id);
  expect(spent.status).toBe("confirmed");
  expect(spent.confirmedAt).toBeTruthy();
});

test("restarting a checkout hands the code back rather than burning it", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode({ maxUses: 1 })],
  });

  const abandoned = await buy({ event, buyer, promo: "EARLY10" });
  // Same buyer, same code, second attempt: the first reservation is released
  // and the second one takes its place rather than hitting the one-use cap.
  const second = await buy({ event, buyer, promo: "EARLY10" });

  const released = await PromoCodeRedemption.findOne({
    purchaseBatchId: abandoned.purchaseBatchId,
  });
  const reserved = await PromoCodeRedemption.findOne({
    purchaseBatchId: second.purchaseBatchId,
  });

  expect(released.status).toBe("released");
  expect(reserved.status).toBe("reserved");
});

test("every ticket in a multi-ticket order carries its own pricing, so the organizer is paid once per ticket", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode({ discountType: "fixed", discountValue: 5000 })],
  });

  const result = await buy({ event, buyer, promo: "EARLY10", quantity: 3 });

  // ₦150,000 of tickets, ₦5,000 off the order.
  expect(result.pricingBreakdown.totalCheckoutNaira).toBe(145000);

  const tickets = await EventTicket.find({
    "paymentMetadata.purchaseBatchId": result.purchaseBatchId,
  }).sort({ createdAt: 1 });

  expect(tickets).toHaveLength(3);

  // A ₦5,000 discount over three tickets, remainder first, adding back up.
  const perTicket = tickets.map(
    (ticket) => ticket.paymentMetadata.pricingBreakdown,
  );
  expect(perTicket.map((row) => row.promoDiscountNaira)).toEqual([
    1667, 1667, 1666,
  ]);
  perTicket.forEach((row) => expect(row.quantity).toBe(1));
  expect(
    perTicket.reduce((sum, row) => sum + row.totalCheckoutNaira, 0),
  ).toBe(145000);

  await settle({ result, buyer });

  // Three tickets at ₦47,500 net, less the ₦5,000 the code gave away. Before
  // per-ticket breakdowns this credited the whole order once per ticket.
  expect(await creditedToOrganizer(organizer._id)).toBe(142500 - 5000);
});

test("an add-on code with no add-on in the order asks for one instead of failing", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = addOn();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    addOns: [parking],
    promoCodes: [
      promoCode({
        code: "PARKFREE",
        name: "Free parking",
        appliesTo: "addons",
        discountType: "fixed",
        discountValue: 5000,
      }),
    ],
  });

  await expect(buy({ event, buyer, promo: "PARKFREE" })).rejects.toMatchObject({
    statusCode: 409,
    code: "PROMO_CODE_NEEDS_ADDON",
  });

  // The preview says the same thing without refusing, so the checkout screen
  // can prompt rather than report a broken code.
  const preview = await previewEventPromoCode({
    eventId: event._id,
    actorUserId: buyer._id,
    payload: { code: "PARKFREE", quantity: 1, addOns: [] },
  });

  expect(preview.needsAddOn).toBe(true);
  expect(preview.discountNaira).toBe(0);
});

test("an add-on code comes off the add-ons, and off what the organizer is paid for them", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const parking = addOn();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    addOns: [parking],
    promoCodes: [
      promoCode({
        code: "PARKFREE",
        appliesTo: "addons",
        discountType: "fixed",
        discountValue: 5000,
      }),
    ],
  });

  const result = await buy({
    event,
    buyer,
    promo: "PARKFREE",
    addOns: [{ addOnId: String(parking._id), quantity: 1 }],
  });

  // ₦50,000 ticket + ₦5,000 parking, with the parking free.
  expect(result.ticket.totalPriceNaira).toBe(50000);

  const held = await EventAddOnPurchase.findOne({
    purchaseBatchId: result.purchaseBatchId,
  });

  // Sold at ₦5,000 and recorded as such, but worth nothing to the organizer.
  expect(held.unitPriceNaira).toBe(5000);
  expect(held.pricingBreakdown.totalCheckoutNaira).toBe(0);
  expect(held.pricingBreakdown.organizerNetNaira).toBe(0);
  // Vera's fee on the add-on is untouched, as with tickets.
  expect(held.pricingBreakdown.veraFeeNaira).toBe(250);
});

test("a code cannot be used twice by the same person, or more times than it has", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const other = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode({ maxUses: 1, perUserLimit: 1 })],
  });

  const first = await buy({ event, buyer, promo: "EARLY10" });
  await settle({ result: first, buyer });

  await expect(buy({ event, buyer, promo: "EARLY10" })).rejects.toMatchObject({
    statusCode: 409,
    code: "PROMO_CODE_ALREADY_USED",
  });

  await expect(buy({ event, buyer: other, promo: "EARLY10" })).rejects.toMatchObject({
    statusCode: 409,
    code: "PROMO_CODE_USED_UP",
  });
});

test("an expired or unknown code is refused, each in its own words", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [
      promoCode({ code: "LAGOS24", endsAt: new Date(Date.now() - HOUR_MS) }),
    ],
  });

  await expect(buy({ event, buyer, promo: "LAGOS24" })).rejects.toMatchObject({
    statusCode: 409,
    code: "PROMO_CODE_EXPIRED",
  });

  await expect(buy({ event, buyer, promo: "NOPE" })).rejects.toMatchObject({
    statusCode: 404,
    code: "PROMO_CODE_UNKNOWN",
  });
});

test("a discounted ticket resells at what was paid, never marked up past the price everyone else pays", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode()],
  });
  // One ticket in the whole event, so buying it sells the event out and
  // unlocks resale — the organizer has no stock left to compete with.
  event.expectedTickets = 1;
  await event.save();

  const result = await buy({ event, buyer, promo: "EARLY10" });
  await settle({ result, buyer });

  const ticket = await EventTicket.findById(result.ticket._id);
  expect(ticket.unitPriceNaira).toBe(45000);

  // The event's 25% markup would allow ₦56,250 on what was paid, but a code
  // is the organizer's gift: it cannot be resold above the ₦50,000 everyone
  // else pays.
  await expect(
    createTicketResale({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      payload: { priceNaira: 50001 },
    }),
  ).rejects.toMatchObject({ statusCode: 400 });

  const listed = await createTicketResale({
    ticketId: ticket._id,
    actorUserId: buyer._id,
    payload: { priceNaira: 45000 },
  });

  expect(listed.resalePriceNaira).toBe(45000);
});

test("the organizer sees what each code has cost them", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode({ maxUses: 100 })],
  });

  const result = await buy({ event, buyer, promo: "EARLY10" });
  await settle({ result, buyer });

  const summary = await listEventPromoCodes({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(summary.items).toHaveLength(1);
  expect(summary.items[0].code).toBe("EARLY10");
  expect(summary.items[0].usedCount).toBe(1);
  expect(summary.items[0].remainingUses).toBe(99);
  expect(summary.givenAwayNaira).toBe(5000);
});

test("only codes the organizer listed are shown to buyers, and only while they are worth tapping", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [
      promoCode({ code: "PUBLIC10", isPublic: true }),
      /* Handed out by name. Listing it would give it to everyone. */
      promoCode({ code: "VIPONLY", name: "For the VIP list" }),
      promoCode({
        code: "GONE",
        name: "Launch week",
        isPublic: true,
        endsAt: new Date(Date.now() - HOUR_MS),
      }),
      promoCode({ code: "PAUSED", name: "Not yet", isPublic: true, active: false }),
    ],
  });

  const available = await listAvailablePromoCodes({
    eventId: event._id,
    actorUserId: buyer._id,
  });

  expect(available.items.map((item) => item.code)).toEqual(["PUBLIC10"]);
  // The offer, never the organizer's figures.
  expect(available.items[0]).not.toHaveProperty("usedCount");
  expect(available.items[0]).not.toHaveProperty("givenAwayNaira");
});

test("a listed code drops off a buyer's list once they have used it", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const other = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode({ isPublic: true, perUserLimit: 1 })],
  });

  const result = await buy({ event, buyer, promo: "EARLY10" });
  await settle({ result, buyer });

  const forBuyer = await listAvailablePromoCodes({
    eventId: event._id,
    actorUserId: buyer._id,
  });
  const forOther = await listAvailablePromoCodes({
    eventId: event._id,
    actorUserId: other._id,
  });

  expect(forBuyer.items).toHaveLength(0);
  expect(forOther.items.map((item) => item.code)).toEqual(["EARLY10"]);
});

test("a buyer never sees the codes they were not given", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await sellingEvent({
    organizerUserId: organizer._id,
    promoCodes: [promoCode()],
  });

  const { getEventById } = require("../services/event.service");
  const detail = await getEventById({
    eventId: event._id,
    actorUserId: buyer._id,
  });

  expect(detail.event.promoCodes).toBeUndefined();
});
