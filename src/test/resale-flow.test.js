/* A ticket resold end to end: listed, offered on, accepted, paid for. Each
   change of state is checked against what the server allows, not what a
   phone might send. */

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "sk_test_resale";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
}));

const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const {
  createTicketResale,
  getTicketResaleOptions,
  createTicketResaleBid,
  acceptTicketResaleBid,
  initializeResalePurchase,
  verifyResalePurchase,
} = require("../services/event.service");
const { verifyPaystackTransaction } = require("../services/paystack.service");
const EventTicket = require("../models/event-ticket.model");
const TicketResaleBid = require("../models/ticket-resale-bid.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

/* One ticket in a one-ticket tier: sold out, so resale is unlocked. */
const soldOutTicket = async ({ resale = {} } = {}) => {
  const organizer = await createUser();
  const seller = await createUser();
  const tier = { _id: new mongoose.Types.ObjectId(), name: "Regular", priceNaira: 10000, quantity: 1 };
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 72 * HOUR_MS),
    endsAt: new Date(Date.now() + 78 * HOUR_MS),
    ticketCategories: [tier],
    resale: { enabled: true, allowBids: true, maxMarkupPercent: 20, bidWindowHours: 6, ...resale },
  });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: seller._id,
    ticketCategoryId: tier._id,
    ticketCategoryName: tier.name,
  });
  return { organizer, seller, event, ticket };
};

const paystackPaid = (amountNaira) =>
  verifyPaystackTransaction.mockResolvedValueOnce({
    status: "success",
    amount: amountNaira * 100,
    currency: "NGN",
  });

describe("resale options come from the server", () => {
  test("the price cap is the event's markup over what was paid", async () => {
    const { seller, ticket } = await soldOutTicket();

    const options = await getTicketResaleOptions({ ticketId: ticket._id, actorUserId: seller._id });

    expect(options.canList).toBe(true);
    expect(options.priceCaps).toEqual([
      {
        quantity: 1,
        faceValueNaira: ticket.unitPriceNaira,
        maxPriceNaira: Math.round(ticket.unitPriceNaira * 1.2),
      },
    ]);
    expect(options.paymentWindowHours).toBe(6);
    expect(options.offersAllowedByEvent).toBe(true);
    expect(options.sellerPayoutsLive).toBe(true);
    expect(options.payoutAccountOnFile).toBe(false);
  });

  test("a ticket that cannot be listed says why", async () => {
    const organizer = await createUser();
    const seller = await createUser();
    const tier = { _id: new mongoose.Types.ObjectId(), name: "VIP", priceNaira: 10000, quantity: 50 };
    const event = await createEvent({
      organizerUserId: organizer._id,
      startsAt: new Date(Date.now() + 72 * HOUR_MS),
      endsAt: new Date(Date.now() + 78 * HOUR_MS),
      ticketCategories: [tier],
    });
    const ticket = await createPaidTicket({ event, buyerUserId: seller._id, ticketCategoryId: tier._id });

    const options = await getTicketResaleOptions({ ticketId: ticket._id, actorUserId: seller._id });

    expect(options.canList).toBe(false);
    expect(options.blockedCode).toBe("RESALE_NOT_UNLOCKED");
    expect(options.blockedReason).toMatch(/still on sale/);
  });

  test("only the holder can see a ticket's resale options", async () => {
    const { ticket } = await soldOutTicket();
    const stranger = await createUser();

    await expect(
      getTicketResaleOptions({ ticketId: ticket._id, actorUserId: stranger._id }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("listing", () => {
  test("a price over the cap is refused", async () => {
    const { seller, ticket } = await soldOutTicket();
    const cap = Math.round(ticket.unitPriceNaira * 1.2);

    await expect(
      createTicketResale({ ticketId: ticket._id, actorUserId: seller._id, payload: { priceNaira: cap + 1 } }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const listed = await createTicketResale({
      ticketId: ticket._id,
      actorUserId: seller._id,
      payload: { priceNaira: cap },
    });
    expect(listed.resaleStatus).toBe("listed");
    expect(listed.resalePriceNaira).toBe(cap);
  });

  test("a seller cannot switch offers on when the event does not take them", async () => {
    const { seller, ticket } = await soldOutTicket({ resale: { allowBids: false } });

    const listed = await createTicketResale({
      ticketId: ticket._id,
      actorUserId: seller._id,
      payload: { priceNaira: 10000, allowBids: true },
    });

    expect(listed.resaleAllowBids).toBe(false);
  });
});

describe("offers", () => {
  test("an offer above the asking price, or on your own ticket, is refused", async () => {
    const { seller, ticket } = await soldOutTicket();
    const bidder = await createUser();
    await createTicketResale({ ticketId: ticket._id, actorUserId: seller._id, payload: { priceNaira: 11000 } });

    await expect(
      createTicketResaleBid({ ticketId: ticket._id, actorUserId: bidder._id, payload: { amountNaira: 11001 } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createTicketResaleBid({ ticketId: ticket._id, actorUserId: seller._id, payload: { amountNaira: 9000 } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("accepting one offer declines the rest and opens the event's payment window", async () => {
    const { seller, ticket } = await soldOutTicket();
    const first = await createUser();
    const second = await createUser();
    await createTicketResale({ ticketId: ticket._id, actorUserId: seller._id, payload: { priceNaira: 11000 } });
    const winning = await createTicketResaleBid({
      ticketId: ticket._id,
      actorUserId: first._id,
      payload: { amountNaira: 10500 },
    });
    const losing = await createTicketResaleBid({
      ticketId: ticket._id,
      actorUserId: second._id,
      payload: { amountNaira: 9000 },
    });

    const before = Date.now();
    await acceptTicketResaleBid({ ticketId: ticket._id, bidId: winning._id, actorUserId: seller._id });

    const held = await EventTicket.findById(ticket._id);
    expect(held.resaleStatus).toBe("offer-accepted");
    expect(String(held.resaleBuyerUserId)).toBe(String(first._id));
    const windowMs = new Date(held.acceptedBidExpiresAt).getTime() - before;
    expect(windowMs).toBeGreaterThan(5.9 * HOUR_MS);
    expect(windowMs).toBeLessThanOrEqual(6 * HOUR_MS + 5000);
    expect((await TicketResaleBid.findById(losing._id)).status).toBe("rejected");
  });
});

describe("buying", () => {
  test("an accepted offer is paid at the offer price and the ticket moves to the buyer", async () => {
    const { seller, ticket } = await soldOutTicket();
    const buyer = await createUser();
    await createTicketResale({ ticketId: ticket._id, actorUserId: seller._id, payload: { priceNaira: 11000 } });
    const bid = await createTicketResaleBid({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      payload: { amountNaira: 10500 },
    });
    await acceptTicketResaleBid({ ticketId: ticket._id, bidId: bid._id, actorUserId: seller._id });

    const checkout = await initializeResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, payload: {} });
    expect(checkout.requiresPayment).toBe(true);

    paystackPaid(10500);
    const result = await verifyResalePurchase({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      reference: checkout.payment.reference,
    });

    const moved = await EventTicket.findById(result.ticket._id);
    expect(String(moved.buyerUserId)).toBe(String(buyer._id));
    expect(moved.totalPriceNaira).toBe(10500);
    expect(moved.resaleStatus).toBe("none");
    expect((await TicketResaleBid.findById(bid._id)).status).toBe("paid");
    /* The seller's copy of the code must stop working. */
    expect(moved.ticketCode).not.toBe(ticket.ticketCode);
    expect(moved.barcodeValue).not.toBe(ticket.barcodeValue);
  });

  test("someone else cannot pay for an offer accepted for another buyer", async () => {
    const { seller, ticket } = await soldOutTicket();
    const buyer = await createUser();
    const other = await createUser();
    await createTicketResale({ ticketId: ticket._id, actorUserId: seller._id, payload: { priceNaira: 11000 } });
    const bid = await createTicketResaleBid({
      ticketId: ticket._id,
      actorUserId: buyer._id,
      payload: { amountNaira: 10500 },
    });
    await acceptTicketResaleBid({ ticketId: ticket._id, bidId: bid._id, actorUserId: seller._id });

    await expect(
      initializeResalePurchase({ ticketId: ticket._id, actorUserId: other._id, payload: {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("an underpaid checkout does not move the ticket", async () => {
    const { seller, ticket } = await soldOutTicket();
    const buyer = await createUser();
    await createTicketResale({
      ticketId: ticket._id,
      actorUserId: seller._id,
      payload: { priceNaira: 11000, allowBids: false },
    });

    const checkout = await initializeResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, payload: {} });
    paystackPaid(100);

    await expect(
      verifyResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, reference: checkout.payment.reference }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(String((await EventTicket.findById(ticket._id)).buyerUserId)).toBe(String(seller._id));
  });

  test("there is no way to take a listed ticket without paying", async () => {
    const { seller, ticket } = await soldOutTicket();
    const taker = await createUser();
    await createTicketResale({
      ticketId: ticket._id,
      actorUserId: seller._id,
      payload: { priceNaira: 11000, allowBids: false },
    });

    const response = await request(app)
      .post(`/api/events/tickets/${ticket._id}/resale-purchase`)
      .set("Authorization", `Bearer ${signAccessToken({ userId: String(taker._id) })}`);

    expect(response.status).toBe(404);
    expect(String((await EventTicket.findById(ticket._id)).buyerUserId)).toBe(String(seller._id));
  });
});
