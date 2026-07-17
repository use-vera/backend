const { updateEventSchema } = require("../validations/event.validation");

// Regression guard: cancellation has real side effects (refunds,
// notifications) and must only happen through the dedicated
// PATCH /events/:eventId/cancel endpoint — the generic update schema must
// never accept "cancelled" again, or the original bug (a status flip with
// no refunds/notifications) becomes reachable through this path.
test("updateEventSchema rejects status: cancelled", () => {
  const result = updateEventSchema.safeParse({ status: "cancelled" });
  expect(result.success).toBe(false);
});

test("updateEventSchema still accepts draft/published", () => {
  expect(updateEventSchema.safeParse({ status: "draft" }).success).toBe(true);
  expect(updateEventSchema.safeParse({ status: "published" }).success).toBe(true);
});
