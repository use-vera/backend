const env = require("../config/env");
const ApiError = require("../utils/api-error");

/**
 * Outbound email, behind one call.
 *
 * Three transports, chosen by EMAIL_PROVIDER:
 *   resend  - HTTPS, no dependency (uses global fetch)
 *   smtp    - requires `npm i nodemailer`, loaded only if actually selected
 *   none    - renders and logs, sends nothing. The development default, so
 *             the app runs without anyone holding a provider account.
 *
 * Nothing here knows what a vendor invite is. Templates live in ../emails.
 */

const REDACTED = "[redacted]";

const normalizeRecipients = (to) => {
  const list = Array.isArray(to) ? to : [to];

  return list
    .map((address) => String(address || "").trim())
    .filter(Boolean);
};

/** Addresses are personal data: log enough to trace a send, never the inbox. */
const maskAddress = (address) => {
  const [name, domain] = String(address).split("@");

  if (!domain) {
    return REDACTED;
  }

  return `${name.slice(0, 2)}***@${domain}`;
};

const sendWithResend = async ({ to, subject, html, text, replyTo }) => {
  if (!env.resendApiKey) {
    throw new ApiError(503, "RESEND_API_KEY is not configured");
  }

  let response;

  try {
    response = await fetch(`${env.resendBaseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (error) {
    throw new ApiError(502, "Could not reach the email provider", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    /* The provider's message is for our logs, never for a client: it can
       echo the recipient address back at us. */
    throw new ApiError(502, "The email provider rejected the message", {
      status: response.status,
      providerMessage: payload?.message || "",
    });
  }

  return { id: payload?.id || "", provider: "resend" };
};

const sendWithSmtp = async ({ to, subject, html, text, replyTo }) => {
  if (!env.smtpUrl) {
    throw new ApiError(503, "SMTP_URL is not configured");
  }

  let nodemailer;

  try {
    // Required lazily so SMTP stays an opt-in extra rather than a dependency
    // every deployment has to carry.
    // eslint-disable-next-line global-require
    nodemailer = require("nodemailer");
  } catch {
    throw new ApiError(
      503,
      "EMAIL_PROVIDER=smtp needs nodemailer. Run: npm i nodemailer",
    );
  }

  const transport = nodemailer.createTransport(env.smtpUrl);

  const info = await transport.sendMail({
    from: env.emailFrom,
    to: to.join(", "),
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  return { id: info?.messageId || "", provider: "smtp" };
};

const sendWithNone = async ({ to, subject }) => {
  console.info(
    "[email] not sent (EMAIL_PROVIDER=none):",
    JSON.stringify({ to: to.map(maskAddress), subject }),
  );

  return { id: "", provider: "none" };
};

const TRANSPORTS = {
  resend: sendWithResend,
  smtp: sendWithSmtp,
  none: sendWithNone,
};

/** True when mail would actually leave the building. */
const isEmailEnabled = () =>
  env.emailProvider !== "none" && Boolean(TRANSPORTS[env.emailProvider]);

/**
 * Sends one message. Throws on failure, so callers that must know (a test, a
 * job that will retry) can. Request paths should use `dispatchEmail`.
 */
const sendEmail = async ({ to, subject, html, text, replyTo }) => {
  const recipients = normalizeRecipients(to);

  if (recipients.length === 0) {
    throw new ApiError(400, "An email needs at least one recipient");
  }

  const trimmedSubject = String(subject || "").trim();

  if (!trimmedSubject) {
    throw new ApiError(400, "An email needs a subject");
  }

  const transport = TRANSPORTS[env.emailProvider];

  if (!transport) {
    throw new ApiError(
      503,
      `Unknown EMAIL_PROVIDER "${env.emailProvider}". Use resend, smtp or none.`,
    );
  }

  return transport({
    to: recipients,
    subject: trimmedSubject,
    html: String(html || ""),
    text: String(text || ""),
    replyTo: replyTo || env.emailReplyTo || "",
  });
};

/**
 * Send-and-forget for request paths: an invite is not undone because the
 * mail server had a bad minute, so a failure is logged and swallowed rather
 * than failing the write that already happened.
 */
const dispatchEmail = async (message) => {
  try {
    return await sendEmail(message);
  } catch (error) {
    console.error(
      "[email] send failed:",
      JSON.stringify({
        subject: message?.subject || "",
        to: normalizeRecipients(message?.to).map(maskAddress),
        reason: error instanceof Error ? error.message : String(error),
      }),
    );

    return null;
  }
};

module.exports = {
  sendEmail,
  dispatchEmail,
  isEmailEnabled,
  maskAddress,
};
