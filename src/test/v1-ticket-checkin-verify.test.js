const {
  verifyTicketForWorkspace,
  checkInTicketForWorkspaceApi,
} = require("../services/v1-ticket.service");
const { checkInTicket } = require("../services/event.service");
const EventTicket = require("../models/event-ticket.model");
const {
  createUser,
  createWorkspace,
  createApiKey,
  createEvent,
  createPaidTicket,
} = require("./fixtures");

const currentlyHappening = () => ({
  startsAt: new Date(Date.now() - 10 * 60 * 1000),
  endsAt: new Date(Date.now() + 50 * 60 * 1000),
});

test("verify does not mutate ticket status", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await verifyTicketForWorkspace({
    workspaceId: workspace._id,
    code: ticket.ticketCode,
  });

  expect(result.valid).toBe(true);
  expect(result.alreadyCheckedIn).toBe(false);

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("paid");
});

test("verify reports the correct reason for a pending ticket", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({
    event,
    buyerUserId: buyer._id,
    status: "pending",
  });

  const result = await verifyTicketForWorkspace({
    workspaceId: workspace._id,
    code: ticket.ticketCode,
  });

  expect(result.valid).toBe(false);
  expect(result.reason).toBe("TICKET_PAYMENT_PENDING");
});

test("API check-in succeeds for a same-workspace ticket and marks it used", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await checkInTicketForWorkspaceApi({
    workspaceId: workspace._id,
    code: ticket.ticketCode,
  });

  expect(result.alreadyCheckedIn).toBe(false);
  expect(result.ticket.status).toBe("used");

  const refreshed = await EventTicket.findById(ticket._id);
  expect(refreshed.status).toBe("used");
  expect(String(refreshed.usedByUserId)).toBe(String(organizer._id));
});

test("API check-in on a cross-workspace ticket 404s", async () => {
  const organizer = await createUser();
  const otherOwner = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const event = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    checkInTicketForWorkspaceApi({ workspaceId: workspace._id, code: ticket.ticketCode }),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
});

test("checking in an already-used ticket reports alreadyCheckedIn without erroring", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await checkInTicketForWorkspaceApi({ workspaceId: workspace._id, code: ticket.ticketCode });
  const second = await checkInTicketForWorkspaceApi({
    workspaceId: workspace._id,
    code: ticket.ticketCode,
  });

  expect(second.alreadyCheckedIn).toBe(true);
});

test("check-in outside the window is rejected with CHECKIN_WINDOW_CLOSED", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  await expect(
    checkInTicketForWorkspaceApi({ workspaceId: workspace._id, code: ticket.ticketCode }),
  ).rejects.toMatchObject({ statusCode: 409, code: "CHECKIN_WINDOW_CLOSED" });
});

test("dashboard checkInTicket behavior is unchanged after the extraction refactor", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    ...currentlyHappening(),
  });
  const ticket = await createPaidTicket({ event, buyerUserId: buyer._id });

  const result = await checkInTicket({
    actorUserId: organizer._id,
    payload: { code: ticket.ticketCode },
  });

  expect(result.alreadyUsed).toBe(false);
  expect(result.ticket.status).toBe("used");
});
