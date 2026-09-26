/* Email is the only part of the invite flow a person sees outside the app, so
   the templates and the transport are both pinned here. Nothing in this file
   touches the network: the "resend" transport is driven through a stubbed
   global fetch. */

process.env.EMAIL_PROVIDER = "none";
process.env.EMAIL_FROM = "Vera <no-reply@vera.test>";
process.env.WEB_BASE_URL = "https://vera.test/";

const env = require("../config/env");
const {
  dispatchEmail,
  isEmailEnabled,
  maskAddress,
  sendEmail,
} = require("../services/email.service");
const {
  vendorApplicationDecided,
  vendorApplied,
  vendorInvited,
  vendorRespondedToInvite,
} = require("../emails/vendor-invite.emails");

const event = {
  name: "Afrobeats Night Lagos",
  startsAtLabel: "Sat 14 Mar, 4:00 PM",
  venue: "Muri Okunola Park",
  ticketsSold: 2400,
};
const vendor = {
  businessName: "Mama Put Express",
  categoriesLabel: "Food, drinks",
  ratingLabel: "4.8",
};
const organizer = { name: "Kininso Events" };
const terms = {
  stallFeeNaira: 25000,
  stallLabel: "Stall 7, main stage",
};

afterEach(() => {
  env.emailProvider = "none";
  delete global.fetch.mock;
});

describe("templates", () => {
  test("an invite tells the vendor the deal and links to the invitation", () => {
    const mail = vendorInvited({ event, vendor, organizer, terms, inviteId: "inv_1" });

    expect(mail.subject).toBe("You're invited to sell at Afrobeats Night Lagos");
    expect(mail.html).toContain("Kininso Events");
    expect(mail.html).toContain("₦25,000");
    expect(mail.html).toContain("Stall 7, main stage");
    // One charge, not two: no share of sales anywhere in the invite.
    expect(mail.html).not.toContain("share of sales");
    // Trailing slash on WEB_BASE_URL must not produce a double slash.
    expect(mail.html).toContain("https://vera.test/vendors/events?invite=inv_1");
    expect(mail.html).not.toContain("https://vera.test//");
    // The plain-text half carries the same facts.
    expect(mail.text).toContain("₦25,000");
    expect(mail.text).toContain("https://vera.test/vendors/events?invite=inv_1");
  });

  test("free terms read as None rather than ₦0", () => {
    const mail = vendorInvited({
      event,
      vendor,
      organizer,
      terms: { stallFeeNaira: 0 },
      inviteId: "inv_2",
    });

    expect(mail.html).toContain("None");
    expect(mail.html).not.toContain("₦0");
  });

  test("a business name with markup in it cannot break out into the email", () => {
    const mail = vendorInvited({
      event,
      vendor: { businessName: "<script>alert('x')</script> & Sons" },
      organizer,
      terms,
      inviteId: "inv_3",
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&amp; Sons");
  });

  test("accept and decline read differently, both ways round", () => {
    const accepted = vendorRespondedToInvite({
      event,
      vendor,
      accepted: true,
      eventId: "evt_1",
    });
    const declined = vendorRespondedToInvite({
      event,
      vendor,
      accepted: false,
      declineReason: "Already booked that day",
      eventId: "evt_1",
    });

    expect(accepted.subject).toContain("accepted");
    expect(accepted.html).toContain("stall is confirmed");
    expect(declined.subject).toContain("declined");
    expect(declined.html).toContain("The spot is open again");
    expect(declined.html).toContain("Already booked that day");
    expect(declined.html).toContain(
      "https://vera.test/organizer/events/evt_1/vendors",
    );
  });

  test("an application notifies the organizer, and its decision notifies the vendor", () => {
    const applied = vendorApplied({ event, vendor, eventId: "evt_1" });
    expect(applied.subject).toBe(
      "New vendor application for Afrobeats Night Lagos",
    );
    expect(applied.html).toContain("Mama Put Express");

    const yes = vendorApplicationDecided({
      event,
      organizer,
      accepted: true,
      terms,
      inviteId: "inv_9",
    });
    expect(yes.html).toContain("Confirm your spot");
    expect(yes.html).toContain("₦25,000");

    const no = vendorApplicationDecided({
      event,
      organizer,
      accepted: false,
      inviteId: "inv_9",
    });
    expect(no.html).toContain("Find another event");
    // A rejection must not carry the terms of a spot that was not given.
    expect(no.html).not.toContain("₦25,000");
  });
});

describe("transport", () => {
  test("EMAIL_PROVIDER=none sends nothing and says so", async () => {
    expect(isEmailEnabled()).toBe(false);

    const result = await sendEmail({
      to: "vendor@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(result.provider).toBe("none");
  });

  test("resend posts the message and returns its id", async () => {
    env.emailProvider = "resend";
    env.resendApiKey = "re_test_key";

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_123" }),
      });

    const result = await sendEmail({
      to: ["vendor@example.com"],
      subject: "You're invited",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(result).toEqual({ id: "msg_123", provider: "resend" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body)).toMatchObject({
      from: "Vera <no-reply@vera.test>",
      to: ["vendor@example.com"],
      subject: "You're invited",
    });

    fetchMock.mockRestore();
  });

  test("a provider failure is swallowed by dispatchEmail, not thrown at the caller", async () => {
    env.emailProvider = "resend";
    env.resendApiKey = "re_test_key";

    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "invalid recipient" }),
    });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendEmail({ to: "vendor@example.com", subject: "Hi", html: "<p>Hi</p>" }),
    ).rejects.toThrow();

    // The same failure through dispatchEmail: logged, and the caller carries on.
    await expect(
      dispatchEmail({
        to: "vendor@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
      }),
    ).resolves.toBeNull();
    expect(errorLog).toHaveBeenCalled();

    fetchMock.mockRestore();
    errorLog.mockRestore();
  });

  test("a message with no recipient is refused", async () => {
    await expect(
      sendEmail({ to: "  ", subject: "Hi", html: "<p>Hi</p>" }),
    ).rejects.toThrow(/recipient/i);
  });

  test("logged addresses are masked", () => {
    expect(maskAddress("folake@example.com")).toBe("fo***@example.com");
    expect(maskAddress("not-an-address")).toBe("[redacted]");
  });
});
