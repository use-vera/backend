/* What onboarding writes after sign-up: a handle, the finished flag, and
   the hosts suggested to follow. */

const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const Category = require("../models/category.model");
const Follow = require("../models/follow.model");
const { createUser, createEvent } = require("./fixtures");

const HOUR_MS = 60 * 60 * 1000;
const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;

const upcoming = (overrides) =>
  createEvent({
    startsAt: new Date(Date.now() + 24 * HOUR_MS),
    endsAt: new Date(Date.now() + 26 * HOUR_MS),
    ...overrides,
  });

describe("handles", () => {
  test("availability reflects shape, reserved names and who already has it", async () => {
    const me = await createUser({ fullName: "Ada Obi" });
    await createUser({ handle: "adaobi" });

    const taken = await request(app)
      .get("/api/users/handles/check?handle=@AdaObi")
      .set("Authorization", auth(me));
    expect(taken.status).toBe(200);
    expect(taken.body.data).toMatchObject({ handle: "adaobi", available: false });
    expect(taken.body.data.suggestions).not.toContain("adaobi");
    expect(taken.body.data.suggestions.length).toBeGreaterThan(0);

    const reserved = await request(app)
      .get("/api/users/handles/check?handle=vera")
      .set("Authorization", auth(me));
    expect(reserved.body.data.available).toBe(false);

    const malformed = await request(app)
      .get("/api/users/handles/check?handle=..ada")
      .set("Authorization", auth(me));
    expect(malformed.body.data.available).toBe(false);

    const free = await request(app)
      .get("/api/users/handles/check?handle=ada.obi")
      .set("Authorization", auth(me));
    expect(free.body.data.available).toBe(true);
  });

  test("saving a taken handle is a 409, not a crash", async () => {
    const me = await createUser();
    await createUser({ handle: "lagosnights" });

    const response = await request(app)
      .patch("/api/users/me")
      .set("Authorization", auth(me))
      .send({ handle: "LagosNights" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("HANDLE_TAKEN");
  });

  test("a valid handle is stored lowercase without the @", async () => {
    const me = await createUser();

    const response = await request(app)
      .patch("/api/users/me")
      .set("Authorization", auth(me))
      .send({ handle: "@Ada_Obi" });

    expect(response.status).toBe(200);
    expect(response.body.data.handle).toBe("ada_obi");
  });
});

describe("finishing onboarding", () => {
  test("needs a handle first, then stamps the finish time", async () => {
    const me = await createUser({ onboardingCompletedAt: null });

    const early = await request(app)
      .post("/api/users/me/onboarding/complete")
      .set("Authorization", auth(me));
    expect(early.status).toBe(400);
    expect(early.body.code).toBe("HANDLE_REQUIRED");

    await request(app)
      .patch("/api/users/me")
      .set("Authorization", auth(me))
      .send({ handle: "ready.now" });

    const done = await request(app)
      .post("/api/users/me/onboarding/complete")
      .set("Authorization", auth(me));
    expect(done.status).toBe(200);
    expect(new Date(done.body.data.onboardingCompletedAt).getTime()).not.toBeNaN();
  });
});

describe("suggested hosts", () => {
  test("ranks by matching scene and state, and skips past, draft, followed and self", async () => {
    const parties = await Category.create({ name: "Parties", slug: "parties", iconKey: "music" });
    const comedy = await Category.create({ name: "Comedy", slug: "comedy", iconKey: "music" });

    const me = await createUser({
      state: "Lagos",
      preferences: { preferredCategoryIds: [parties._id] },
    });

    const partyHostInLagos = await createUser({ fullName: "Rooftop Sessions" });
    const partyHostElsewhere = await createUser({ fullName: "Abuja Raves" });
    const comedyHostInLagos = await createUser({ fullName: "Laugh Lagos" });
    const pastHost = await createUser({ fullName: "Old News" });
    const draftHost = await createUser({ fullName: "Not Yet" });
    const followedHost = await createUser({ fullName: "Already Friends" });

    await upcoming({ organizerUserId: partyHostInLagos._id, state: "Lagos", categoryIds: [parties._id] });
    await upcoming({ organizerUserId: partyHostElsewhere._id, state: "FCT (Abuja)", categoryIds: [parties._id] });
    await upcoming({ organizerUserId: comedyHostInLagos._id, state: "lagos", categoryIds: [comedy._id] });
    await createEvent({ organizerUserId: pastHost._id, state: "Lagos", categoryIds: [parties._id] });
    await upcoming({ organizerUserId: draftHost._id, state: "Lagos", categoryIds: [parties._id], status: "draft" });
    await upcoming({ organizerUserId: followedHost._id, state: "Lagos", categoryIds: [parties._id] });
    await upcoming({ organizerUserId: me._id, state: "Lagos", categoryIds: [parties._id] });

    await Follow.create({ followerUserId: me._id, followingUserId: followedHost._id });

    const response = await request(app)
      .get("/api/users/me/suggested-hosts")
      .set("Authorization", auth(me));

    expect(response.status).toBe(200);
    expect(response.body.data.items.map((item) => item.fullName)).toEqual([
      "Rooftop Sessions",
      "Abuja Raves",
      "Laugh Lagos",
    ]);
    expect(response.body.data.items[0].reason).toBe("Hosts parties in Lagos");
    expect(response.body.data.items[2].reason).toBe("Hosting in Lagos");
  });
});
