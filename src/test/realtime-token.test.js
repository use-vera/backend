/* The web app cannot read its own bearer token, so it asks for a second,
   much weaker one to open a socket with. The point of that token is what it
   CANNOT do. */

const request = require("supertest");
const app = require("../app");
const { signAccessToken, verifyAccessToken } = require("../utils/jwt");
const { createUser } = require("./fixtures");

const tokenFor = (user) => signAccessToken({ userId: String(user._id) });

const mint = (user) =>
  request(app)
    .post("/api/auth/realtime-token")
    .set("Authorization", `Bearer ${tokenFor(user)}`);

test("a signed-in user is issued a realtime token for their own id", async () => {
  const user = await createUser();

  const response = await mint(user);

  expect(response.status).toBe(200);

  const payload = verifyAccessToken(response.body.data.token);
  expect(payload.userId).toBe(String(user._id));
  expect(payload.scope).toBe("realtime");

  /* Short enough that one sitting in browser memory is worth little. */
  expect(payload.exp - payload.iat).toBeLessThanOrEqual(5 * 60);
});

test("a realtime token cannot be used against the HTTP API", async () => {
  const user = await createUser();
  const { token } = (await mint(user)).body.data;

  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(401);
});

test("nobody gets a realtime token without signing in first", async () => {
  const response = await request(app).post("/api/auth/realtime-token");

  expect(response.status).toBe(401);
});
