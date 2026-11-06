/* The emails that follow something that happened: who gets them, and that
   each one goes once, however often the trigger repeats. */

jest.mock("../services/email.service", () => ({
  ...jest.requireActual("../services/email.service"),
  sendEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  dispatchEmail: jest.fn().mockResolvedValue({ id: "test", provider: "test" }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");
const app = require("../app");
const { sendEmail, dispatchEmail } = require("../services/email.service");
const { signAccessToken } = require("../utils/jwt");
const { createSession } = require("../services/session.service");
const { completeOnboarding } = require("../services/user.service");
const { purgeDeletedAccounts } = require("../services/account-deletion.service");
const { finalizeWithdrawalSuccess, finalizeWithdrawalFailure } = require("../services/withdrawal.service");
const { sendPremiumExpiryNotices } = require("../services/premium-expiry-monitor.service");
const User = require("../models/user.model");
const Withdrawal = require("../models/withdrawal.model");
const PayoutAccount = require("../models/payout-account.model");
const OrganizerWallet = require("../models/organizer-wallet.model");
const { createUser } = require("./fixtures");

const DAY = 24 * 60 * 60 * 1000;
const auth = (user) => `Bearer ${signAccessToken({ userId: String(user._id) })}`;

/* The sends are fire-and-forget, so give their lookups a moment to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const sent = () => dispatchEmail.mock.calls.map(([message]) => message);
const sentWithSubject = (pattern) => sent().filter((message) => pattern.test(message.subject));

beforeEach(() => {
  dispatchEmail.mockClear();
  sendEmail.mockClear();
});

test("finishing onboarding sends the welcome once", async () => {
  const me = await createUser({ email: "new@example.com", fullName: "Ada Obi", handle: "adanew" });

  await completeOnboarding(me._id);
  await completeOnboarding(me._id);
  await settle();

  const welcomes = sentWithSubject(/Welcome to Vera/);
  expect(welcomes).toHaveLength(1);
  expect(welcomes[0].to).toBe("new@example.com");
  expect(welcomes[0].html).toContain("welcome in, ada.");
});

test("only a device the account hasn't used before triggers a sign-in alert", async () => {
  const me = await createUser({ email: "phone@example.com" });
  const phone = { device: { name: "iPhone 15", platform: "ios" } };

  await createSession({ userId: me._id, context: phone }); // first ever sign-in
  await createSession({ userId: me._id, context: phone }); // same phone again
  await settle();
  expect(sentWithSubject(/New sign-in/)).toHaveLength(0);

  await createSession({ userId: me._id, context: { device: { name: "Pixel 9", platform: "android" } } });
  await settle();
  const alerts = sentWithSubject(/New sign-in/);
  expect(alerts).toHaveLength(1);
  expect(alerts[0].html).toContain("Pixel 9");
});

test("deleting emails the old address now, and again once the purge has erased everything", async () => {
  const me = await createUser({ email: "leaving@example.com", handle: "adaleaving" });

  await request(app).post("/api/users/me/delete/code").set("Authorization", auth(me)).expect(200);
  const code = sendEmail.mock.calls.at(-1)[0].subject.match(/^(\d{6})/)[1];
  await request(app).post("/api/users/me/delete").set("Authorization", auth(me)).send({ code }).expect(200);
  await settle();

  const started = sentWithSubject(/account is deleted/);
  expect(started).toHaveLength(1);
  expect(started[0].to).toBe("leaving@example.com");

  await purgeDeletedAccounts({});
  await purgeDeletedAccounts({});
  await settle();

  const finished = sentWithSubject(/data has been erased/);
  expect(finished).toHaveLength(1);
  expect(finished[0].to).toBe("leaving@example.com");
  // Nothing of the address is left behind after that.
  const after = await User.findById(me._id).select("+deletionNoticeEmail").lean();
  expect(after.deletionNoticeEmail).toBeUndefined();
});

const setUpWithdrawal = async ({ reference }) => {
  const me = await createUser({ email: `payout_${reference}@example.com` });
  const account = await PayoutAccount.create({
    organizerUserId: me._id,
    bankCode: "058",
    bankName: "GTBank",
    accountNumber: "0123451234",
    accountName: "Ada Obi",
  });
  await OrganizerWallet.create({ organizerUserId: me._id, availableBalanceKobo: 0, reservedBalanceKobo: 5000000 });
  await Withdrawal.create({
    organizerUserId: me._id,
    payoutAccountId: account._id,
    amountKobo: 5000000,
    status: "processing",
    paystackReference: reference,
  });
  return me;
};

test("a completed withdrawal emails once, even when Paystack repeats the webhook", async () => {
  const me = await setUpWithdrawal({ reference: "wd_ok" });

  await finalizeWithdrawalSuccess({ paystackReference: "wd_ok" });
  await finalizeWithdrawalSuccess({ paystackReference: "wd_ok" });
  await settle();

  const receipts = sentWithSubject(/on its way to your bank/);
  expect(receipts).toHaveLength(1);
  expect(receipts[0].to).toBe(me.email);
  expect(receipts[0].html).toContain("₦50,000");
  expect(receipts[0].html).toContain("GTBank •• 1234");
});

test("a withdrawal that fails later emails once, saying the money is back", async () => {
  await setUpWithdrawal({ reference: "wd_bad" });

  await finalizeWithdrawalFailure({ paystackReference: "wd_bad", reason: "Account closed" });
  await finalizeWithdrawalFailure({ paystackReference: "wd_bad", reason: "Account closed" });
  await settle();

  const notices = sentWithSubject(/didn't go through/);
  expect(notices).toHaveLength(1);
  expect(notices[0].html).toContain("back in your Vera wallet");
});

test("Premium ending soon goes once per term, and again after renewing", async () => {
  const now = new Date();
  const endsSoon = new Date(now.getTime() + 2 * DAY);
  const me = await createUser({ subscriptionTier: "premium", subscriptionStatus: "active", premiumExpiresAt: endsSoon });
  await createUser({ subscriptionTier: "premium", subscriptionStatus: "active", premiumExpiresAt: new Date(now.getTime() + 20 * DAY) });

  await sendPremiumExpiryNotices({ now });
  await sendPremiumExpiryNotices({ now });
  await settle();
  expect(sentWithSubject(/Premium ends on/).map((message) => message.to)).toEqual([me.email]);

  // A renewal moves the expiry; the next term's reminder is its own.
  const renewedUntil = new Date(endsSoon.getTime() + 30 * DAY);
  await User.updateOne({ _id: me._id }, { $set: { premiumExpiresAt: renewedUntil } });
  await sendPremiumExpiryNotices({ now: new Date(renewedUntil.getTime() - 2 * DAY) });
  await settle();
  expect(sentWithSubject(/Premium ends on/)).toHaveLength(2);
});
