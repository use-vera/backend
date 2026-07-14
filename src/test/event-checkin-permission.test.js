const { getEventById } = require("../services/event.service");
const Membership = require("../models/membership.model");
const { createUser, createEvent, createWorkspace } = require("./fixtures");

test("canManageCheckIns is true for the event's own organizer", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const result = await getEventById({
    eventId: event._id,
    actorUserId: organizer._id,
  });

  expect(result.canManageCheckIns).toBe(true);
});

test("canManageCheckIns is true for an admin of the event's own workspace", async () => {
  const owner = await createUser();
  const staffAdmin = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  await Membership.create({
    workspaceId: workspace._id,
    userId: staffAdmin._id,
    role: "admin",
    status: "active",
  });
  const event = await createEvent({
    organizerUserId: owner._id,
    workspaceId: workspace._id,
  });

  const result = await getEventById({
    eventId: event._id,
    actorUserId: staffAdmin._id,
  });

  expect(result.canManageCheckIns).toBe(true);
});

test("canManageCheckIns is false for an admin of a DIFFERENT workspace viewing this event", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const otherWorkspaceOwner = await createUser();
  await createWorkspace({ ownerUserId: otherWorkspaceOwner._id });

  const result = await getEventById({
    eventId: event._id,
    actorUserId: otherWorkspaceOwner._id,
  });

  expect(result.canManageCheckIns).toBe(false);
});

test("canManageCheckIns is false for a plain ticket holder with no workspace role", async () => {
  const organizer = await createUser();
  const buyer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const result = await getEventById({
    eventId: event._id,
    actorUserId: buyer._id,
  });

  expect(result.canManageCheckIns).toBe(false);
});
