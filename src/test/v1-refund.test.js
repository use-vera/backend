jest.mock("../services/paystack.service", () => ({
  ...jest.requireActual("../services/paystack.service"),
  initiatePaystackRefund: jest.fn().mockResolvedValue({ status: "processed" }),
}));

const { refundTicketForWorkspace } = require("../services/v1-refund.service");
const EventTicket = require("../models/event-ticket.model");
const {
  createUser,
  createWorkspace,
  createEvent,
  createPaidTicket,
} = require("./fixtures");

test("API refund reuses the existing atomic refund path unchanged", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await refundTicketForWorkspace({
    workspaceId: workspace._id,
    ticketId: ticket._id,
    reason: "requested via API",
  });

  expect(result.status).toBe("refunded");

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("refunded");
});

test("refunding a cross-workspace ticket 404s", async () => {
  const organizer = await createUser();
  const otherOwner = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const event = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    refundTicketForWorkspace({ workspaceId: workspace._id, ticketId: ticket._id }),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
});

test("refunding an already-refunded ticket is rejected as not refundable", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await refundTicketForWorkspace({ workspaceId: workspace._id, ticketId: ticket._id });

  // A sequential second call sees status "refunded" already and is rejected
  // by the ordinary refundable-status check; TICKET_ALREADY_REFUNDED is
  // reserved for the atomic claim losing a genuine concurrent race.
  await expect(
    refundTicketForWorkspace({ workspaceId: workspace._id, ticketId: ticket._id }),
  ).rejects.toMatchObject({ code: "TICKET_NOT_REFUNDABLE" });
});
