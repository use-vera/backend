const { listWorkspaceOrders, getWorkspaceOrder } = require("../services/v1-order.service");
const {
  listWorkspaceEventsForApi,
  getWorkspaceEventForApi,
  listWorkspaceEventTicketTypesForApi,
} = require("../services/v1-catalog.service");
const {
  createUser,
  createWorkspace,
  createEvent,
  createPaidTicket,
} = require("./fixtures");

test("listWorkspaceOrders only returns tickets scoped to the workspace", async () => {
  const organizer = await createUser();
  const otherOwner = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const event = await createEvent({ organizerUserId: organizer._id, workspaceId: workspace._id });
  const otherEvent = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
  });
  await createPaidTicket({ event, buyerUserId: buyer._id });
  await createPaidTicket({ event: otherEvent, buyerUserId: buyer._id });

  const result = await listWorkspaceOrders({ workspaceId: workspace._id, page: 1, limit: 20 });

  expect(result.items).toHaveLength(1);
  expect(result.meta.totalItems).toBe(1);
});

test("getWorkspaceOrder 404s for a cross-workspace ticket id", async () => {
  const organizer = await createUser();
  const otherOwner = await createUser();
  const buyer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const otherWorkspace = await createWorkspace({ ownerUserId: otherOwner._id });
  const otherEvent = await createEvent({
    organizerUserId: otherOwner._id,
    workspaceId: otherWorkspace._id,
  });
  const ticket = await createPaidTicket({ event: otherEvent, buyerUserId: buyer._id });

  await expect(
    getWorkspaceOrder({ workspaceId: workspace._id, ticketId: ticket._id }),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
});

test("listWorkspaceEventsForApi only returns published events for the workspace", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    status: "published",
  });
  await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    status: "draft",
  });

  const result = await listWorkspaceEventsForApi({ workspaceId: workspace._id, page: 1, limit: 20 });

  expect(result.items).toHaveLength(1);
  expect(result.items[0].salePhase).toBeDefined();
});

test("getWorkspaceEventForApi 404s for a draft event", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    status: "draft",
  });

  await expect(
    getWorkspaceEventForApi({ workspaceId: workspace._id, eventId: event._id }),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
});

test("listWorkspaceEventTicketTypesForApi returns ticket categories with remaining quantity", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    status: "published",
    ticketCategories: [{ name: "VIP", quantity: 10, priceNaira: 20000 }],
  });

  const types = await listWorkspaceEventTicketTypesForApi({
    workspaceId: workspace._id,
    eventId: event._id,
  });

  expect(types).toHaveLength(1);
  expect(types[0].name).toBe("VIP");
  expect(types[0].remainingQuantity).toBe(10);
});

test("listWorkspaceEventTicketTypesForApi falls back to general admission with no categories", async () => {
  const organizer = await createUser();
  const workspace = await createWorkspace({ ownerUserId: organizer._id });
  const event = await createEvent({
    organizerUserId: organizer._id,
    workspaceId: workspace._id,
    status: "published",
    expectedTickets: 50,
  });

  const types = await listWorkspaceEventTicketTypesForApi({
    workspaceId: workspace._id,
    eventId: event._id,
  });

  expect(types).toHaveLength(1);
  expect(types[0].name).toBe("General admission");
  expect(types[0].remainingQuantity).toBe(50);
});
