/* Who may refund a ticket: the host always, the buyer only once the host has
   cancelled. A buyer otherwise sells the ticket on. */

jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackRefund: jest.fn().mockResolvedValue({ status: "processed" }),
}));

const { refundTicket } = require("../services/refund.service");
const { initiatePaystackRefund } = require("../services/paystack.service");
const Event = require("../models/event.model");
const EventTicket = require("../models/event-ticket.model");
const { createUser, createEvent, createPaidTicket } = require("./fixtures");

const setup = async ({ status = "paid" } = {}) => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id, status });
  return { organizer, buyer, event, ticket };
};

beforeEach(() => {
  initiatePaystackRefund.mockClear();
});

test("a buyer cannot refund a ticket for an event that is going ahead", async () => {
  const { buyer, ticket } = await setup();

  await expect(refundTicket({ ticketId: ticket._id, actorUserId: buyer._id })).rejects.toMatchObject({
    statusCode: 403,
    code: "REFUND_NOT_ALLOWED",
  });

  expect(initiatePaystackRefund).not.toHaveBeenCalled();
  expect((await EventTicket.findById(ticket._id)).status).toBe("paid");
});

test("a buyer cannot refund a ticket they have already been let in on", async () => {
  const { buyer, ticket } = await setup({ status: "used" });

  await expect(refundTicket({ ticketId: ticket._id, actorUserId: buyer._id })).rejects.toMatchObject({
    code: "REFUND_NOT_ALLOWED",
  });
  expect((await EventTicket.findById(ticket._id)).status).toBe("used");
});

test("a buyer can refund once the host has cancelled", async () => {
  const { buyer, event, ticket } = await setup();
  await Event.updateOne({ _id: event._id }, { $set: { status: "cancelled", cancelledAt: new Date() } });

  await refundTicket({ ticketId: ticket._id, actorUserId: buyer._id });

  expect(initiatePaystackRefund).toHaveBeenCalledTimes(1);
  expect((await EventTicket.findById(ticket._id)).status).toBe("refunded");
});

test("the host can refund a ticket whether or not the event is cancelled", async () => {
  const { organizer, ticket } = await setup();

  await refundTicket({ ticketId: ticket._id, actorUserId: organizer._id });

  expect((await EventTicket.findById(ticket._id)).status).toBe("refunded");
});

test("someone unrelated still cannot refund, cancelled or not", async () => {
  const { event, ticket } = await setup();
  const stranger = await createUser();
  await Event.updateOne({ _id: event._id }, { $set: { status: "cancelled" } });

  await expect(refundTicket({ ticketId: ticket._id, actorUserId: stranger._id })).rejects.toMatchObject({
    statusCode: 403,
  });
});
