const request = require("supertest");
const app = require("../app");
const { signAccessToken } = require("../utils/jwt");
const Follow = require("../models/follow.model");
const { createUser } = require("./fixtures");

const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;

/* The chats "People" tab reads this endpoint. It asked for 200 at a time,
   which is over the cap, so the tab only ever rendered a validation error. */
test("the People tab's page size is inside what this endpoint accepts", async () => {
  const me = await createUser();

  const rejected = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=200`)
    .set("Authorization", auth(me));
  expect(rejected.status).toBe(400);

  const accepted = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=50`)
    .set("Authorization", auth(me));
  expect(accepted.status).toBe(200);
});

test("following is searchable and paginated on the server", async () => {
  const me = await createUser();
  const ada = await createUser({ fullName: "Ada Lovelace" });
  const grace = await createUser({ fullName: "Grace Hopper" });
  const alan = await createUser({ fullName: "Alan Turing" });

  await Follow.create([
    { followerUserId: me._id, followingUserId: ada._id },
    { followerUserId: me._id, followingUserId: grace._id },
    { followerUserId: me._id, followingUserId: alan._id },
  ]);

  const all = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=50`)
    .set("Authorization", auth(me));
  expect(all.status).toBe(200);
  expect(all.body.data.items).toHaveLength(3);

  /* Searching has to reach the server: a client filtering one loaded page
     can never find someone who sits on the next one. */
  const hit = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=50&search=grace`)
    .set("Authorization", auth(me));
  expect(hit.status).toBe(200);
  expect(hit.body.data.items).toHaveLength(1);
  expect(hit.body.data.items[0].fullName).toBe("Grace Hopper");
  expect(hit.body.data.totalItems).toBe(1);

  // Paging reports honestly, so the tab knows whether to load more.
  const firstPage = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=2`)
    .set("Authorization", auth(me));
  expect(firstPage.body.data.items).toHaveLength(2);
  expect(firstPage.body.data.hasNextPage).toBe(true);

  // A regex metacharacter is a search term, not a pattern, and not a crash.
  const weird = await request(app)
    .get(`/api/follows/${me._id}/following?page=1&limit=50&search=${encodeURIComponent("c++")}`)
    .set("Authorization", auth(me));
  expect(weird.status).toBe(200);
  expect(weird.body.data.items).toHaveLength(0);
});
