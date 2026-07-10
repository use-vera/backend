const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const {
  createCategory,
  updateCategory,
  listCategories,
} = require("../services/category.service");
const { createUser } = require("./fixtures");

const tokenFor = (user) => signAccessToken({ userId: String(user._id) });

test("creating a category auto-derives a slug", async () => {
  const category = await createCategory({ name: "Live Music", iconKey: "music" });

  expect(category.slug).toBe("live-music");
  expect(category.isActive).toBe(true);
});

test("creating a category with a duplicate name is rejected", async () => {
  await createCategory({ name: "Comedy", iconKey: "comedy" });

  await expect(createCategory({ name: "Comedy", iconKey: "comedy" })).rejects.toMatchObject({
    statusCode: 409,
  });
});

test("listCategories excludes inactive categories by default, includes them with includeInactive", async () => {
  const active = await createCategory({ name: "Sports", iconKey: "sports" });
  const hidden = await createCategory({ name: "Nightlife", iconKey: "nightlife" });
  await updateCategory(hidden._id, { isActive: false });

  const defaultList = await listCategories();
  expect(defaultList.map((c) => c.name)).toEqual([active.name]);

  const fullList = await listCategories({ includeInactive: true });
  expect(fullList.map((c) => c.name).sort()).toEqual(["Nightlife", "Sports"]);
});

test("updateCategory rejects an unknown category id", async () => {
  const fakeId = "665f1a2b3c4d5e6f7a8b9c0d";

  await expect(updateCategory(fakeId, { isActive: false })).rejects.toMatchObject({
    statusCode: 404,
  });
});

test("a non-admin authenticated user cannot create a category via the route", async () => {
  const user = await createUser();

  const response = await request(app)
    .post("/api/categories")
    .set("Authorization", `Bearer ${tokenFor(user)}`)
    .send({ name: "Tech Talks", iconKey: "tech" });

  expect(response.status).toBe(403);
});

test("an admin can create a category via the route, and it appears in the public listing", async () => {
  const admin = await createUser({ isPlatformAdmin: true });

  const createResponse = await request(app)
    .post("/api/categories")
    .set("Authorization", `Bearer ${tokenFor(admin)}`)
    .send({ name: "Family Fun", iconKey: "other" });

  expect(createResponse.status).toBe(201);
  expect(createResponse.body.data.slug).toBe("family-fun");

  const publicResponse = await request(app).get("/api/public/categories");
  expect(publicResponse.body.data.map((c) => c.name)).toContain("Family Fun");
});

test("an invalid iconKey is rejected by validation", async () => {
  const admin = await createUser({ isPlatformAdmin: true });

  const response = await request(app)
    .post("/api/categories")
    .set("Authorization", `Bearer ${tokenFor(admin)}`)
    .send({ name: "Whatever", iconKey: "not-a-real-key" });

  expect(response.status).toBe(400);
});

test("the public categories route ignores an includeInactive=true bypass attempt", async () => {
  const hidden = await createCategory({ name: "Retired Category", iconKey: "other" });
  await updateCategory(hidden._id, { isActive: false });

  const response = await request(app).get("/api/public/categories?includeInactive=true");

  expect(response.body.data.map((c) => c.name)).not.toContain("Retired Category");
});
