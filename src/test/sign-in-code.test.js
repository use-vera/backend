/* Passwordless sign-in: an emailed six-digit code, then either a session
   (existing account) or a sign-up token (new address). */

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  sendEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");
const app = require("../app");
const { sendEmail } = require("../services/email.service");
const authService = require("../services/auth.service");
const EmailOtp = require("../models/email-otp.model");
const User = require("../models/user.model");
const { createUser } = require("./fixtures");

/** The code the last email carried, read from its subject line. */
const lastSentCode = () => {
  const { subject } = sendEmail.mock.calls.at(-1)[0];
  return subject.match(/^(\d{6})/)[1];
};

const wrongCodeFor = (code) => (code === "000000" ? "111111" : "000000");

beforeEach(() => {
  sendEmail.mockClear();
});

test("a new address verifies, gets a sign-up token, and finishes as an account mid-onboarding", async () => {
  const email = "new.person@example.com";

  const requested = await request(app)
    .post("/api/auth/code/request")
    .send({ email: "  New.Person@Example.com " });
  expect(requested.status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail.mock.calls[0][0].to).toBe(email);

  const verified = await request(app)
    .post("/api/auth/code/verify")
    .send({ email, code: lastSentCode() });
  expect(verified.status).toBe(200);
  expect(verified.body.data.status).toBe("needs_profile");
  expect(verified.body.data.token).toBeUndefined();

  const { signupToken } = verified.body.data;

  /* The sign-up token is not a way into the API. */
  const sneaky = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${signupToken}`);
  expect(sneaky.status).toBe(401);

  const noTerms = await request(app)
    .post("/api/auth/code/complete-signup")
    .send({ signupToken, fullName: "New Person", acceptTerms: false });
  expect(noTerms.status).toBe(400);

  const created = await request(app)
    .post("/api/auth/code/complete-signup")
    .send({
      signupToken,
      fullName: "New Person",
      acceptTerms: true,
      marketingOptIn: true,
    });
  expect(created.status).toBe(201);
  expect(created.body.data.token).toEqual(expect.any(String));
  expect(created.body.data.user.email).toBe(email);
  expect(created.body.data.user.onboardingCompletedAt).toBeNull();

  const stored = await User.findOne({ email });
  expect(stored.termsAcceptedAt).toBeInstanceOf(Date);
  expect(stored.preferences.marketingOptIn).toBe(true);

  /* A second "Join" tap signs in rather than failing or duplicating. */
  const again = await request(app)
    .post("/api/auth/code/complete-signup")
    .send({ signupToken, fullName: "New Person", acceptTerms: true });
  expect(again.status).toBe(201);
  expect(await User.countDocuments({ email })).toBe(1);

  /* No password was ever set, so password sign-in must fail cleanly. */
  const passwordAttempt = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "whatever-123" });
  expect(passwordAttempt.status).toBe(401);
});

test("an existing account is signed straight in, and an old account isn't sent through onboarding", async () => {
  const existing = await createUser({ email: "old.timer@example.com" });

  await authService.requestSignInCode({ email: existing.email });
  const result = await authService.verifySignInCode({
    email: existing.email,
    code: lastSentCode(),
  });

  expect(result.status).toBe("signed_in");
  expect(result.token).toEqual(expect.any(String));
  expect(String(result.user._id)).toBe(String(existing._id));
  /* Absent, not null: the app reads null as "still onboarding". */
  expect(result.user.onboardingCompletedAt).toBeUndefined();
});

test("a code works once", async () => {
  const email = "once@example.com";
  await authService.requestSignInCode({ email });
  const code = lastSentCode();

  await authService.verifySignInCode({ email, code });

  await expect(authService.verifySignInCode({ email, code })).rejects.toMatchObject({
    statusCode: 400,
    code: "OTP_EXPIRED",
  });
});

test("five wrong guesses lock the code, even against the right one", async () => {
  const email = "guesser@example.com";
  await authService.requestSignInCode({ email });
  const code = lastSentCode();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(
      authService.verifySignInCode({ email, code: wrongCodeFor(code) }),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
  }

  await expect(authService.verifySignInCode({ email, code })).rejects.toMatchObject({
    statusCode: 429,
    code: "OTP_LOCKED",
  });
});

test("an expired code is refused", async () => {
  const email = "late@example.com";
  await authService.requestSignInCode({ email });
  const code = lastSentCode();

  await EmailOtp.updateOne({ email }, { expiresAt: new Date(Date.now() - 1000) });

  await expect(authService.verifySignInCode({ email, code })).rejects.toMatchObject({
    code: "OTP_EXPIRED",
  });
});

test("asking again straight away is a cooldown, and a new code replaces the old one", async () => {
  const email = "eager@example.com";
  await authService.requestSignInCode({ email });
  const firstCode = lastSentCode();

  await expect(authService.requestSignInCode({ email })).rejects.toMatchObject({
    statusCode: 429,
    code: "OTP_COOLDOWN",
  });

  /* Past the cooldown, a fresh code goes out and the first stops working. */
  await EmailOtp.updateOne({ email }, { lastSentAt: new Date(Date.now() - 60 * 1000) });
  await authService.requestSignInCode({ email });
  const secondCode = lastSentCode();

  if (secondCode !== firstCode) {
    await expect(
      authService.verifySignInCode({ email, code: firstCode }),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
  }

  const result = await authService.verifySignInCode({ email, code: secondCode });
  expect(result.status).toBe("needs_profile");
});

test("an inbox can't be sent more than five codes an hour", async () => {
  const email = "spam.target@example.com";

  for (let send = 0; send < 5; send += 1) {
    await authService.requestSignInCode({ email });
    await EmailOtp.updateOne({ email }, { lastSentAt: new Date(Date.now() - 60 * 1000) });
  }

  await expect(authService.requestSignInCode({ email })).rejects.toMatchObject({
    statusCode: 429,
    code: "OTP_SEND_LIMIT",
  });
});

test("a code the provider failed to send doesn't hold the inbox in a cooldown", async () => {
  const email = "bounced@example.com";
  sendEmail.mockRejectedValueOnce(new Error("provider down"));

  await expect(authService.requestSignInCode({ email })).rejects.toThrow(
    "provider down",
  );
  expect(await EmailOtp.exists({ email })).toBeNull();

  await expect(authService.requestSignInCode({ email })).resolves.toMatchObject({
    email,
  });
});

test("the email never reveals whether an account exists", async () => {
  await createUser({ email: "member@example.com" });

  const forMember = await authService.requestSignInCode({
    email: "member@example.com",
  });
  const forStranger = await authService.requestSignInCode({
    email: "stranger@example.com",
  });

  expect(Object.keys(forMember).sort()).toEqual(Object.keys(forStranger).sort());
});
