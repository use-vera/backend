/* Paying resale sellers: held until 24 hours after the event, sent to their
   bank once, never twice, and called off if the event is cancelled. */

process.env.PAYSTACK_SECRET_KEY = "sk_test_resale_payouts";

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initializePaystackTransaction: jest.fn().mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/mock",
    access_code: "mock_access_code",
    reference: "mock_reference",
  }),
  verifyPaystackTransaction: jest.fn(),
  initiatePaystackTransfer: jest.fn(),
  verifyPaystackTransfer: jest.fn(),
  initiatePaystackRefund: jest.fn(),
}));

const mongoose = require("mongoose");
const ApiError = require("../utils/api-error");
const {
  createTicketResale,
  cancelTicketResale,
  createTicketResaleBid,
  acceptTicketResaleBid,
  initializeResalePurchase,
  verifyResalePurchase,
  purchaseResaleTicket,
  processPaystackWebhookEvent,
} = require("../services/event.service");
const {
  releaseDueResaleSales,
  cancelResaleSalesForEvent,
} = require("../services/resale-payout.service");
const paystack = require("../services/paystack.service");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const ResaleSale = require("../models/resale-sale.model");
const PayoutAccount = require("../models/payout-account.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;

const listedTicket = async ({ quantity = 1, allowBids = false } = {}) => {
  const organizer = await createUser();
  const seller = await createUser();
  const tier = { _id: new mongoose.Types.ObjectId(), name: "Regular", priceNaira: 10000, quantity };
  const event = await createEvent({
    organizerUserId: organizer._id,
    startsAt: new Date(Date.now() + 72 * HOUR_MS),
    endsAt: new Date(Date.now() + 78 * HOUR_MS),
    ticketCategories: [tier],
    resale: { enabled: true, allowBids: true, maxMarkupPercent: 20, bidWindowHours: 6 },
  });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: seller._id,
    ticketCategoryId: tier._id,
    ticketCategoryName: tier.name,
    quantity,
  });
  await createTicketResale({
    ticketId: ticket._id,
    actorUserId: seller._id,
    payload: { priceNaira: 11000, quantity: 1, allowBids },
  });
  return { organizer, seller, event, ticket };
};

const addPayoutAccount = (userId) =>
  PayoutAccount.create({
    organizerUserId: userId,
    bankCode: "058",
    bankName: "GTBank",
    accountNumber: "0123456789",
    accountName: "Test Seller",
    paystackRecipientCode: "RCP_test",
    kycStatus: "verified",
    verifiedAt: new Date(),
  });

/* A sale whose hold has already ended, ready to pay. */
const dueSale = async (overrides = {}) => {
  const organizer = await createUser();
  const seller = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  return ResaleSale.create({
    eventId: event._id,
    sourceTicketId: new mongoose.Types.ObjectId(),
    ticketId: new mongoose.Types.ObjectId(),
    sellerUserId: seller._id,
    buyerUserId: buyer._id,
    quantity: 1,
    amountKobo: 1_100_000,
    resalePaymentReference: `vera_ticket_resale_purchase_${new mongoose.Types.ObjectId()}`,
    sellerPaymentReference: "seller_original_ref",
    sellerPaidKobo: 1_000_000,
    releaseAt: new Date(Date.now() - HOUR_MS),
    ...overrides,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("recording the sale", () => {
  test("a paid resale is held until 24 hours after the event ends", async () => {
    const { seller, event, ticket } = await listedTicket();
    const buyer = await createUser();

    const checkout = await initializeResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, payload: {} });
    paystack.verifyPaystackTransaction.mockResolvedValueOnce({ status: "success", amount: 1_100_000, currency: "NGN" });
    await verifyResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, reference: checkout.payment.reference });

    const sale = await ResaleSale.findOne({ resalePaymentReference: checkout.payment.reference });
    expect(sale.status).toBe("held");
    expect(String(sale.sellerUserId)).toBe(String(seller._id));
    expect(sale.amountKobo).toBe(1_100_000);
    expect(sale.sellerPaymentReference).toBe(ticket.paymentReference);
    expect(sale.releaseAt.getTime()).toBe(new Date(event.endsAt).getTime() + 24 * HOUR_MS);
  });

  test("the same payment arriving twice at once issues one ticket and records one sale", async () => {
    const { ticket } = await listedTicket({ quantity: 2 });
    const buyer = await createUser();
    await initializeResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, payload: {} });
    const ticketsBefore = await EventTicket.countDocuments();

    const purchase = () =>
      purchaseResaleTicket({
        ticketId: String(ticket._id),
        actorUserId: buyer._id,
        paymentReference: "vera_same_payment",
        paymentData: { status: "success", amount: 1_100_000 },
      });
    const results = await Promise.allSettled([purchase(), purchase()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await ResaleSale.countDocuments({ resalePaymentReference: "vera_same_payment" })).toBe(1);
    expect(await EventTicket.countDocuments()).toBe(ticketsBefore + 1);
  });
});

describe("paying out", () => {
  test("nothing is paid before the hold ends", async () => {
    const sale = await dueSale({ releaseAt: new Date(Date.now() + HOUR_MS) });
    await addPayoutAccount(sale.sellerUserId);

    await releaseDueResaleSales({});

    expect(paystack.initiatePaystackTransfer).not.toHaveBeenCalled();
    expect((await ResaleSale.findById(sale._id)).status).toBe("held");
  });

  test("with no bank on file the money waits, and adding one sends it", async () => {
    const sale = await dueSale();

    await releaseDueResaleSales({});
    expect((await ResaleSale.findById(sale._id)).status).toBe("awaiting_account");
    expect(paystack.initiatePaystackTransfer).not.toHaveBeenCalled();

    await addPayoutAccount(sale.sellerUserId);
    paystack.initiatePaystackTransfer.mockResolvedValueOnce({ transfer_code: "TRF_1", status: "pending" });
    await releaseDueResaleSales({ sellerUserId: sale.sellerUserId });

    expect(paystack.initiatePaystackTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 1_100_000, recipientCode: "RCP_test" }),
    );
    expect((await ResaleSale.findById(sale._id)).status).toBe("processing");
  });

  test("running the payout job twice sends one transfer", async () => {
    const sale = await dueSale();
    await addPayoutAccount(sale.sellerUserId);
    paystack.initiatePaystackTransfer.mockResolvedValue({ transfer_code: "TRF_1", status: "pending" });

    await Promise.all([releaseDueResaleSales({}), releaseDueResaleSales({})]);
    await releaseDueResaleSales({});

    expect(paystack.initiatePaystackTransfer).toHaveBeenCalledTimes(1);
  });

  test("the transfer webhook marks it paid, and a repeat changes nothing", async () => {
    const sale = await dueSale();
    await addPayoutAccount(sale.sellerUserId);
    paystack.initiatePaystackTransfer.mockResolvedValueOnce({ transfer_code: "TRF_1", status: "pending" });
    await releaseDueResaleSales({});
    const { transferReference } = await ResaleSale.findById(sale._id);

    await processPaystackWebhookEvent({ event: "transfer.success", data: { reference: transferReference } });
    const paid = await ResaleSale.findById(sale._id);
    await processPaystackWebhookEvent({ event: "transfer.success", data: { reference: transferReference } });

    expect(paid.status).toBe("paid");
    expect((await ResaleSale.findById(sale._id)).paidAt.getTime()).toBe(paid.paidAt.getTime());
  });

  test("a failed transfer is retried with a new reference", async () => {
    const sale = await dueSale();
    await addPayoutAccount(sale.sellerUserId);
    paystack.initiatePaystackTransfer.mockResolvedValue({ transfer_code: "TRF", status: "pending" });
    await releaseDueResaleSales({});
    const first = (await ResaleSale.findById(sale._id)).transferReference;

    await processPaystackWebhookEvent({ event: "transfer.failed", data: { reference: first } });
    expect((await ResaleSale.findById(sale._id)).status).toBe("failed");

    await releaseDueResaleSales({});
    const retried = await ResaleSale.findById(sale._id);
    expect(retried.status).toBe("processing");
    expect(retried.transferReference).not.toBe(first);
    expect(paystack.initiatePaystackTransfer).toHaveBeenCalledTimes(2);
  });

  test("an unclear network error is checked with Paystack, not resent", async () => {
    const sale = await dueSale();
    await addPayoutAccount(sale.sellerUserId);
    paystack.initiatePaystackTransfer.mockRejectedValueOnce(new ApiError(502, "Could not reach Paystack"));

    await releaseDueResaleSales({});
    expect((await ResaleSale.findById(sale._id)).status).toBe("processing");

    /* Later, with no webhook: Paystack says it went through. */
    paystack.verifyPaystackTransfer.mockResolvedValueOnce({ status: "success" });
    await releaseDueResaleSales({ now: new Date(Date.now() + 15 * 60 * 1000) });

    expect(paystack.initiatePaystackTransfer).toHaveBeenCalledTimes(1);
    expect((await ResaleSale.findById(sale._id)).status).toBe("paid");
  });
});

describe("when the event is cancelled", () => {
  test("the payout is called off and the seller gets back what they paid", async () => {
    const sale = await dueSale({ releaseAt: new Date(Date.now() + HOUR_MS) });
    await addPayoutAccount(sale.sellerUserId);
    const event = await Event.findByIdAndUpdate(sale.eventId, { $set: { status: "cancelled" } }, { new: true });
    paystack.initiatePaystackRefund.mockResolvedValueOnce({ status: "processed" });

    await cancelResaleSalesForEvent(event);
    await releaseDueResaleSales({ now: new Date(Date.now() + 2 * HOUR_MS) });

    const cancelled = await ResaleSale.findById(sale._id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.sellerRefund.status).toBe("refunded");
    expect(paystack.initiatePaystackRefund).toHaveBeenCalledWith({
      transactionReference: "seller_original_ref",
      amountKobo: 1_000_000,
    });
    expect(paystack.initiatePaystackTransfer).not.toHaveBeenCalled();
  });
});

describe("protecting a buyer mid-payment", () => {
  test("a seller cannot take a listing down while the buyer is paying", async () => {
    const { seller, ticket } = await listedTicket({ allowBids: true });
    const buyer = await createUser();
    const bid = await createTicketResaleBid({ ticketId: ticket._id, actorUserId: buyer._id, payload: { amountNaira: 10500 } });
    await acceptTicketResaleBid({ ticketId: ticket._id, bidId: bid._id, actorUserId: seller._id });

    await expect(cancelTicketResale({ ticketId: ticket._id, actorUserId: seller._id })).rejects.toMatchObject({
      code: "RESALE_BUYER_PAYING",
    });
  });

  test("a buyer who paid for a ticket that can no longer be issued is refunded", async () => {
    const { ticket } = await listedTicket();
    const buyer = await createUser();
    const checkout = await initializeResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, payload: {} });
    /* The ticket gets scanned at the door before the payment lands. */
    await EventTicket.updateOne({ _id: ticket._id }, { $set: { status: "used", usedAt: new Date() } });
    paystack.verifyPaystackTransaction.mockResolvedValueOnce({ status: "success", amount: 1_100_000, currency: "NGN" });
    paystack.initiatePaystackRefund.mockResolvedValueOnce({ status: "processed" });

    await expect(
      verifyResalePurchase({ ticketId: ticket._id, actorUserId: buyer._id, reference: checkout.payment.reference }),
    ).rejects.toMatchObject({ statusCode: 410, code: "RESALE_UNAVAILABLE_REFUNDED" });

    expect(paystack.initiatePaystackRefund).toHaveBeenCalledWith({
      transactionReference: checkout.payment.reference,
      amountKobo: 1_100_000,
    });
    expect(await ResaleSale.countDocuments({ resalePaymentReference: checkout.payment.reference })).toBe(0);
  });
});
