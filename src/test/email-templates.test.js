/* Every email shares one shell, matching the "Sign-in code email" design on
   the auth canvas. These render each template with real-looking data and pin
   the parts a person sees: the ink header with the green mark, Gilroy, the
   lowercase headline with a full stop, and no template holes. */

process.env.WEB_BASE_URL = "https://vera.test/";

const auth = require("../emails/auth.emails");
const { ticketReceipt } = require("../emails/receipt.emails");
const { ticketSent } = require("../emails/transfer.emails");
const vendor = require("../emails/vendor-invite.emails");
const account = require("../emails/account.emails");
const money = require("../emails/money.emails");

const event = { name: "Afrobeats Night Lagos", startsAtLabel: "Sat 14 Mar, 4:00 PM", venue: "Muri Okunola Park", ticketsSold: 2400 };
const vendorInfo = { businessName: "Mama Put Express", categoriesLabel: "Food, drinks", ratingLabel: "4.8" };
const organizer = { name: "Kininso Events" };

const receipt = {
  receiptNumber: "VR-2026-000123",
  event: { name: "Afrobeats Night Lagos", startsAt: "2026-11-14T19:00:00.000Z", organizerName: "Kininso Events" },
  lines: [{ label: "2 × Regular", amountNaira: 13000 }],
  upgrades: [],
  grandTotalNaira: 13000,
  paidAt: "2026-10-28T10:00:00.000Z",
  method: { brand: "Visa", last4: "4242" },
  reference: "ps_ref_1",
  billedTo: { name: "Ada Obi", email: "ada@example.com" },
  refundedNaira: 0,
};

const rendered = {
  signInCode: auth.signInCode({ code: "482906", email: "ada@example.com", expiresInMinutes: 10 }),
  emailChangeCode: auth.emailChangeCode({ code: "482906", email: "ada@example.com", expiresInMinutes: 10 }),
  accountDeleteCode: auth.accountDeleteCode({ code: "482906", email: "ada@example.com", expiresInMinutes: 10 }),
  emailChanged: auth.emailChanged({ newEmail: "ada.new@example.com" }),
  ticketReceipt: ticketReceipt({ receipt }),
  ticketSent: ticketSent({
    fromName: "Chidi Okafor",
    eventName: "Afrobeats Night Lagos",
    eventStartsAt: "2026-11-14T19:00:00.000Z",
    tierName: "Regular",
    quantity: 1,
    note: "See you there",
    token: "tok_123",
    recipientEmail: "ada@example.com",
  }),
  vendorInvited: vendor.vendorInvited({ event, vendor: vendorInfo, organizer, terms: { stallFeeNaira: 25000 }, inviteId: "inv_1" }),
  vendorResponded: vendor.vendorRespondedToInvite({ event, vendor: vendorInfo, organizer, accepted: true, eventId: "evt_1" }),
  vendorApplied: vendor.vendorApplied({ event, vendor: vendorInfo, eventId: "evt_1" }),
  vendorDecided: vendor.vendorApplicationDecided({ event, vendor: vendorInfo, organizer, accepted: true, inviteId: "inv_1" }),
  welcome: account.welcome({ fullName: "Ada Obi", email: "ada@example.com" }),
  newSignIn: account.newSignIn({ deviceName: "iPhone 15", platform: "ios", signedInAt: "2026-10-28T10:00:00.000Z", email: "ada@example.com" }),
  accountDeletionStarted: account.accountDeletionStarted({ email: "ada@example.com", eraseWithinDays: 30 }),
  accountDeletionCompleted: account.accountDeletionCompleted({ email: "ada@example.com" }),
  premiumReceipt: account.premiumReceipt({ amountNaira: 4999, activeUntil: "2026-11-27T10:00:00.000Z", renewed: false, reference: "ps_ref_2", email: "ada@example.com" }),
  premiumEndingSoon: account.premiumEndingSoon({ expiresAt: "2026-11-27T10:00:00.000Z", email: "ada@example.com" }),
  eventCancelled: money.eventCancelled({ eventName: "Afrobeats Night Lagos", startsAt: "2026-11-14T19:00:00.000Z", organizerName: "Kininso Events", reason: "Venue flooded", refundNaira: 13000, email: "ada@example.com" }),
  eventCancelledFree: money.eventCancelled({ eventName: "Afrobeats Night Lagos", startsAt: null, organizerName: "", reason: "", refundNaira: 0, email: "ada@example.com" }),
  refundIssued: money.refundIssued({ eventName: "Afrobeats Night Lagos", refundNaira: 6500, reason: "Duplicate purchase", email: "ada@example.com" }),
  withdrawalSent: money.withdrawalSent({ amountNaira: 50000, bankName: "GTBank", last4: "1234", reference: "wd_1", sentAt: "2026-10-28T10:00:00.000Z", email: "ada@example.com" }),
  withdrawalFailed: money.withdrawalFailed({ amountNaira: 50000, email: "ada@example.com" }),
  resaleSold: money.resaleSold({ eventName: "Afrobeats Night Lagos", amountNaira: 15000, quantity: 1, payoutDelayHours: 48, email: "ada@example.com" }),
  resalePayoutPaid: money.resalePayoutPaid({ amountNaira: 15000, bankName: "GTBank", last4: "1234", email: "ada@example.com" }),
  resalePayoutNeedsAccount: money.resalePayoutNeedsAccount({ amountNaira: 15000, email: "ada@example.com" }),
};

describe("email templates", () => {
  test.each(Object.entries(rendered))("%s uses the canvas shell and has no holes", (_name, email) => {
    expect(email.subject).toBeTruthy();
    expect(email.html).not.toMatch(/undefined|null|\[object Object\]|NaN/);
    expect(email.text).not.toMatch(/undefined|\[object Object\]|NaN/);
    expect(email.html).toContain("https://vera.test/brand/vera-mark-email.png");
    expect(email.html).toContain("Gilroy");
    expect(email.html).toContain("#16150F");
    const heading = email.html.match(/<h1[^>]*>([^<]*)<\/h1>/)[1];
    expect(heading.trim().endsWith(".") || heading.trim().endsWith("?")).toBe(true);
  });

  test("codes sit in the ink block with the second half in green, and say who they were sent to", () => {
    const { html, text } = rendered.signInCode;
    expect(html).toMatch(/482<span style="color: #15C67C;">906<\/span>/);
    expect(html).toContain("Sent to ada@example.com from a sign-in request.");
    expect(html).toContain("we'll never ask you to share it");
    expect(text).toContain("482 906");
  });

  test("people's words are escaped before they reach the markup", () => {
    const { html } = money.eventCancelled({ eventName: "<b>Night</b>", organizerName: "A & B", reason: "<script>x</script>", refundNaira: 100 });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Night&lt;/b&gt;");
    expect(html).toContain("A &amp; B");
  });
});
