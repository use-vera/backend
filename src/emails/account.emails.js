const { absoluteUrl, detailRows, formatNaira, muted, paragraph, renderEmail, renderText, escapeHtml } = require("./layout");

/* All pure: each returns { subject, html, text } and sends nothing. */

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString("en-NG", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Africa/Lagos",
      })
    : "";

const formatDay = (value) =>
  value ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "";

const firstNameOf = (name) => String(name || "").trim().split(/\s+/)[0] || "";

/** After onboarding: what to do first. */
const welcome = ({ fullName, email }) => {
  const first = firstNameOf(fullName).toLowerCase();
  const heading = first ? `welcome in, ${first}.` : "welcome in.";
  const steps = [
    "Pick your scenes, so Home shows events you'll actually like.",
    "Follow your friends to see where they're going.",
    "Ask Vera what to do tonight. She picks, says why, and never spends your money.",
  ];

  return {
    subject: "Welcome to Vera",
    html: renderEmail({
      previewText: "Three things to do first.",
      heading,
      footerNote: email ? `Sent to ${email} because you just joined Vera.` : undefined,
      bodyHtml: [
        paragraph("You're in. Three things make Vera yours:"),
        ...steps.map((step, index) => paragraph(`<strong>${index + 1}.</strong> ${escapeHtml(step)}`)),
      ].join(""),
      cta: { href: absoluteUrl("/download"), label: "Open Vera" },
    }),
    text: renderText({
      heading,
      lines: ["You're in. Three things make Vera yours:", "", ...steps.map((step, index) => `${index + 1}. ${step}`)],
      cta: { href: absoluteUrl("/download"), label: "Open Vera" },
    }),
  };
};

/** Someone signed in on a device this account hasn't used before. */
const newSignIn = ({ deviceName, platform, signedInAt, email }) => {
  const heading = "new sign-in.";
  const device = [deviceName, platform && platform !== "unknown" ? platform : null].filter(Boolean).join(" · ") || "a new device";

  return {
    subject: "New sign-in to your Vera account",
    html: renderEmail({
      previewText: `Signed in on ${device}.`,
      heading,
      footerNote: email ? `Sent to ${email} because your account was signed in on a new device.` : undefined,
      bodyHtml: [
        paragraph("Your Vera account was just signed in on a new device."),
        detailRows([
          { label: "Device", value: device },
          { label: "When", value: formatWhen(signedInAt) },
        ]),
        paragraph("If this was you, there's nothing to do."),
        muted(
          "Not you? Open Vera, go to You, then Settings, then Privacy and security, and sign out everywhere else. Nobody can sign in without a code sent to this email, so check nobody else can read it.",
        ),
      ].join(""),
    }),
    text: renderText({
      heading,
      footerNote: email ? `Sent to ${email} because your account was signed in on a new device.` : undefined,
      lines: [
        "Your Vera account was just signed in on a new device.",
        `Device: ${device}`,
        `When: ${formatWhen(signedInAt)}`,
        "",
        "If this was you, there's nothing to do.",
        "Not you? In Vera, go to You > Settings > Privacy and security and sign out everywhere else.",
      ],
    }),
  };
};

/** Straight after deleting: what's gone now, what goes soon, what stays. */
const accountDeletionStarted = ({ email, eraseWithinDays }) => {
  const heading = "your account is deleted.";

  return {
    subject: "Your Vera account is deleted",
    html: renderEmail({
      previewText: `Everything else is erased within ${eraseWithinDays} days.`,
      heading,
      footerNote: email ? `Sent to ${email}, the address that was on the account.` : undefined,
      bodyHtml: [
        paragraph("Your profile, name and handle are gone, and you've been signed out everywhere."),
        paragraph(
          `Everything else, your messages, posts, ratings and check-ins, is erased within ${eraseWithinDays} days. It usually happens within the hour, and we'll email once more when it's done.`,
        ),
        muted(
          "Receipts for things you bought stay, without your name or email, because the law asks us to keep them. You can join again with this email any time; it'll be a fresh start.",
        ),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        "Your profile, name and handle are gone, and you've been signed out everywhere.",
        `Everything else is erased within ${eraseWithinDays} days, usually within the hour. We'll email once more when it's done.`,
        "",
        "Receipts stay, without your name or email, because the law asks us to keep them.",
      ],
    }),
  };
};

/** The last email: everything is erased. */
const accountDeletionCompleted = ({ email }) => {
  const heading = "everything's erased.";

  return {
    subject: "Your Vera data has been erased",
    html: renderEmail({
      previewText: "This is the last email you'll get from Vera.",
      heading,
      footerNote: email ? `Sent to ${email}. We've now forgotten this address too.` : undefined,
      bodyHtml: [
        paragraph("We've finished erasing your Vera account. Your messages, posts, ratings and check-ins are gone."),
        muted("This is the last email you'll get from us. Thanks for coming out with us."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: ["We've finished erasing your Vera account.", "This is the last email you'll get from us. Thanks for coming out with us."],
    }),
  };
};

/** Premium paid for: a receipt with the date it runs to. */
const premiumReceipt = ({ amountNaira, activeUntil, renewed, reference, email }) => {
  const heading = renewed ? "premium renewed." : "you're premium.";

  return {
    subject: renewed ? "Your Vera Premium is renewed" : "Welcome to Vera Premium",
    html: renderEmail({
      previewText: `Active until ${formatDay(activeUntil)}.`,
      heading,
      footerNote: email ? `Sent to ${email}. Keep this as your receipt.` : undefined,
      bodyHtml: [
        paragraph(
          renewed
            ? `Thanks for staying. Premium now runs until <strong>${escapeHtml(formatDay(activeUntil))}</strong>.`
            : `Premium is on. It runs until <strong>${escapeHtml(formatDay(activeUntil))}</strong>, and we'll remind you a few days before it ends.`,
        ),
        detailRows([
          { label: "Plan", value: "Vera Premium" },
          { label: "Paid", value: formatNaira(amountNaira) },
          { label: "Active until", value: formatDay(activeUntil) },
          { label: "Reference", value: reference },
        ]),
        muted("Premium doesn't renew by itself, so you're never charged without saying so."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `Premium runs until ${formatDay(activeUntil)}.`,
        `Paid: ${formatNaira(amountNaira)}`,
        reference ? `Reference: ${reference}` : "",
        "",
        "Premium doesn't renew by itself, so you're never charged without saying so.",
      ],
    }),
  };
};

/** A few days before Premium ends. It never renews on its own. */
const premiumEndingSoon = ({ expiresAt, email }) => {
  const heading = "premium ends soon.";

  return {
    subject: `Your Vera Premium ends on ${formatDay(expiresAt)}`,
    html: renderEmail({
      previewText: "Renew in the app to keep it going.",
      heading,
      footerNote: email ? `Sent to ${email} because your Premium is about to end.` : undefined,
      bodyHtml: [
        paragraph(`Your Premium ends on <strong>${escapeHtml(formatDay(expiresAt))}</strong>.`),
        paragraph("To keep it, open Vera and go to You, then Settings, then Vera Premium. It doesn't renew by itself."),
        muted("If you let it end, nothing is lost. Your tickets, plans and wallet stay exactly as they are."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `Your Premium ends on ${formatDay(expiresAt)}.`,
        "To keep it, open Vera and go to You > Settings > Vera Premium. It doesn't renew by itself.",
      ],
    }),
  };
};

module.exports = {
  welcome,
  newSignIn,
  accountDeletionStarted,
  accountDeletionCompleted,
  premiumReceipt,
  premiumEndingSoon,
};
