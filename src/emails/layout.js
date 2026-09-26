const env = require("../config/env");

/**
 * The shell every Vera email is rendered into.
 *
 * Table-based and inline-styled on purpose: email clients ignore stylesheets,
 * flexbox and most of what the web takes for granted. Colours are Vera's own
 * (web/app/globals.css), written as literal hexes since custom properties do
 * not resolve in mail either.
 */

const COLORS = {
  background: "#f5f3ef",
  card: "#ffffff",
  ink: "#16150f",
  muted: "#6b695d",
  border: "#e1ddd1",
  primary: "#0fb26e",
  primaryInk: "#16150f",
  accent: "#ddf3e9",
  accentInk: "#0c8f5a",
};

/** Escapes anything that came from a person before it lands in markup. */
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatNaira = (amountNaira) =>
  `₦${Math.round(Number(amountNaira || 0)).toLocaleString("en-NG")}`;

const absoluteUrl = (path = "/") =>
  `${env.webBaseUrl}${String(path).startsWith("/") ? path : `/${path}`}`;

const button = ({ href, label }) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 26px 0 8px;">
  <tr>
    <td align="center" bgcolor="${COLORS.primary}" style="border-radius: 999px;">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 14px 28px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 700; color: ${COLORS.primaryInk}; text-decoration: none;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;

/** A label/value list, the shape every one of these emails needs. */
const detailRows = (rows = []) => {
  const cells = rows
    .filter((row) => row && row.value)
    .map(
      (row) => `
      <tr>
        <td style="padding: 7px 0; font-size: 14px; color: ${COLORS.muted};">${escapeHtml(row.label)}</td>
        <td align="right" style="padding: 7px 0; font-size: 14px; font-weight: 600; color: ${COLORS.ink};">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");

  if (!cells) {
    return "";
  }

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 22px 0 6px; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
  ${cells}
</table>`;
};

/**
 * @param {object} input
 * @param {string} input.previewText Shown next to the subject in the inbox.
 * @param {string} input.heading
 * @param {string} input.bodyHtml Already-escaped markup.
 * @param {{href: string, label: string}} [input.cta]
 * @param {string} [input.footerNote]
 */
const renderEmail = ({ previewText, heading, bodyHtml, cta, footerNote }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${COLORS.background};">
<span style="display: none !important; visibility: hidden; opacity: 0; height: 0; width: 0; overflow: hidden;">${escapeHtml(previewText)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${COLORS.background}; padding: 32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 16px; overflow: hidden;">
        <tr>
          <td style="padding: 26px 32px 0;">
            <span style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-weight: 800; color: ${COLORS.ink}; letter-spacing: -0.01em;">Vera</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 18px 32px 32px; font-family: 'Helvetica Neue', Arial, sans-serif;">
            <h1 style="margin: 0 0 14px; font-size: 24px; line-height: 1.25; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(heading)}</h1>
            ${bodyHtml}
            ${cta ? button(cta) : ""}
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">
        <tr>
          <td style="padding: 18px 32px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 1.5; color: ${COLORS.muted};">
            ${footerNote ? `${escapeHtml(footerNote)}<br><br>` : ""}
            Sent by Vera. If you were not expecting this, you can ignore it.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const paragraph = (html) =>
  `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: ${COLORS.ink};">${html}</p>`;

const muted = (html) =>
  `<p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: ${COLORS.muted};">${html}</p>`;

/** The plain-text half. Some clients show it, and spam filters expect it. */
const renderText = ({ heading, lines = [], cta }) =>
  [
    heading,
    "",
    ...lines.filter(Boolean),
    ...(cta ? ["", `${cta.label}: ${cta.href}`] : []),
    "",
    "Sent by Vera. If you were not expecting this, you can ignore it.",
  ].join("\n");

module.exports = {
  COLORS,
  absoluteUrl,
  button,
  detailRows,
  escapeHtml,
  formatNaira,
  muted,
  paragraph,
  renderEmail,
  renderText,
};
