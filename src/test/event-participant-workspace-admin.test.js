const { getEventReminder, upsertEventReminder } = require("../services/event.service");
const Membership = require("../models/membership.model");
const { createUser, createEvent, createWorkspace } = require("./fixtures");

// Regression test for a real bug: the mobile client shows the
// reminders/chat UI to any workspace admin (permissions.canManageOrg),
// not just the event's literal organizer or a ticket holder — but the
// backend's ensureEventParticipant only recognized the literal organizer
// or a ticket holder, so a workspace admin viewing a teammate's event hit
// "Only attendees or organizers can access this action" the moment they
// tried to use reminders/chat, despite the UI implying they could.

test("a workspace admin (not the event's literal organizer, no ticket) can access event reminders", async () => {
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

  await expect(
    getEventReminder({ eventId: event._id, actorUserId: staffAdmin._id }),
  ).resolves.toBeDefined();

  await expect(
    upsertEventReminder({
      eventId: event._id,
      actorUserId: staffAdmin._id,
      payload: { enabled: true },
    }),
  ).resolves.toBeDefined();
});

test("a plain member (not admin/owner) of the event's workspace still cannot access reminders without a ticket", async () => {
  const owner = await createUser();
  const staffMember = await createUser();
  const workspace = await createWorkspace({ ownerUserId: owner._id });
  await Membership.create({
    workspaceId: workspace._id,
    userId: staffMember._id,
    role: "member",
    status: "active",
  });
  const event = await createEvent({
    organizerUserId: owner._id,
    workspaceId: workspace._id,
  });

  await expect(
    getEventReminder({ eventId: event._id, actorUserId: staffMember._id }),
  ).rejects.toMatchObject({
    statusCode: 403,
    message: expect.stringContaining("attendees or organizers"),
  });
});

test("an admin of a DIFFERENT workspace still cannot access reminders for this event", async () => {
  const organizer = await createUser();
  const event = await createEvent({ organizerUserId: organizer._id });

  const otherWorkspaceOwner = await createUser();
  await createWorkspace({ ownerUserId: otherWorkspaceOwner._id });

  await expect(
    getEventReminder({ eventId: event._id, actorUserId: otherWorkspaceOwner._id }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
