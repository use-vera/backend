const { codeBlock, muted, paragraph, renderEmail, renderText } = require("./layout");

/**
 * The emailed sign-in code. Pure: returns { subject, html, text } and sends
 * nothing, so it can be rendered in a test.
 */
const signInCode = ({ code, email, expiresInMinutes }) => {
  const sentTo = email ? `Sent to ${email} from a sign-in request.` : undefined;
  const heading = "here's your code.";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  return {
    // The code leads the subject so it can be read from the notification.
    subject: `${code} is your Vera code`,
    html: renderEmail({
      previewText: `${spaced} — enter it in the Vera app to sign in.`,
      heading,
      footerNote: sentTo,
      bodyHtml: [
        paragraph(
          `Enter this in the Vera app to sign in. It works once and expires in ${expiresInMinutes} minutes.`,
        ),
        codeBlock(code),
        muted(
          "Didn't ask for this? Ignore this email. Nobody can sign in without the code, and we'll never ask you to share it.",
        ),
      ].join(""),
    }),
    text: renderText({
      heading,
      footerNote: sentTo,
      lines: [
        `Your Vera code is ${spaced}.`,
        `It works once and expires in ${expiresInMinutes} minutes.`,
        "",
        "Didn't ask for this? Ignore this email.",
      ],
    }),
  };
};

/** The code that confirms a new sign-in email. Sent to the new address. */
const emailChangeCode = ({ code, email, expiresInMinutes }) => {
  const sentTo = email ? `Sent to ${email} because someone asked to make it their Vera sign-in email.` : undefined;
  const heading = "confirm your new email.";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  return {
    subject: `${code} confirms your new Vera email`,
    html: renderEmail({
      previewText: `${spaced} — enter it in Vera to make this your sign-in email.`,
      heading,
      footerNote: sentTo,
      bodyHtml: [
        paragraph(
          `Enter this in the Vera app to make this address your sign-in email. It works once and expires in ${expiresInMinutes} minutes.`,
        ),
        codeBlock(code),
        muted("Didn't ask for this? Ignore this email. Nothing changes without the code, and we'll never ask you to share it."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `Your code is ${spaced}.`,
        `Enter it in Vera to make this your sign-in email. It expires in ${expiresInMinutes} minutes.`,
        "",
        "Didn't ask for this? Ignore this email.",
      ],
    }),
  };
};

/** The code that confirms deleting the account. */
const accountDeleteCode = ({ code, email, expiresInMinutes }) => {
  const sentTo = email ? `Sent to ${email} from a request to delete this Vera account.` : undefined;
  const heading = "delete your account?";
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  return {
    subject: `${code} confirms deleting your Vera account`,
    html: renderEmail({
      previewText: `${spaced} — enter it in Vera to delete your account.`,
      heading,
      footerNote: sentTo,
      bodyHtml: [
        paragraph(
          `Enter this in the Vera app to delete your account for good. It works once and expires in ${expiresInMinutes} minutes.`,
        ),
        codeBlock(code),
        muted("Didn't ask for this? Ignore this email and your account stays as it is. We'll never ask you to share this code."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `Your code is ${spaced}.`,
        `Enter it in Vera to delete your account for good. It expires in ${expiresInMinutes} minutes.`,
        "",
        "Didn't ask for this? Ignore this email and nothing changes.",
      ],
    }),
  };
};

/* Hides most of an address: "ad***@gmail.com". */
const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return "a new address";
  return `${name.slice(0, 2)}***@${domain}`;
};

/** Sent to the old address once the change is done, in case it wasn't them. */
const emailChanged = ({ newEmail }) => {
  const heading = "your sign-in email changed.";
  const masked = maskEmail(newEmail);

  return {
    subject: "Your Vera sign-in email was changed",
    html: renderEmail({
      previewText: `Codes now go to ${masked}.`,
      heading,
      bodyHtml: [
        paragraph(`Your Vera sign-in email is now ${masked}. Sign-in codes go there from now on, and your other devices were signed out.`),
        muted("Wasn't you? Contact Vera support straight away so we can secure the account."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `Your Vera sign-in email is now ${masked}.`,
        "Sign-in codes go there from now on, and your other devices were signed out.",
        "",
        "Wasn't you? Contact Vera support straight away so we can secure the account.",
      ],
    }),
  };
};

module.exports = { signInCode, emailChangeCode, accountDeleteCode, emailChanged, maskEmail };
