const env = require("../config/env");

/**
 * The shell every Vera email is rendered into, matching the "Sign-in code
 * email" design on the auth canvas: a warm grey page, a cream card with an
 * ink header carrying the green Vera mark, big lowercase headlines, and a
 * quiet footer inside the card.
 *
 * Table-based and inline-styled on purpose: email clients ignore most of
 * what the web takes for granted. Gilroy is loaded from the website for the
 * clients that honour @font-face (Apple Mail, iOS); everyone else falls back
 * to the system sans the design names. The mark is a PNG because Gmail and
 * Outlook drop SVG.
 */

const COLORS = {
  page: "#EDEAE2",
  card: "#FAF8F4",
  ink: "#16150F",
  paper: "#F5F3EF",
  body: "#4A4A40",
  muted: "#7A786C",
  border: "#E1DDD1",
  green: "#15C67C",
  link: "#0C8F5A",
  greenSoft: "#DDF3E9",
};

const FONT = "Gilroy, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

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

const fontFaces = () =>
  [
    ["Regular", 400],
    ["Medium", 500],
    ["SemiBold", 600],
    ["ExtraBold", 800],
  ]
    .map(
      ([name, weight]) =>
        `@font-face{font-family:"Gilroy";src:url("${absoluteUrl(`/fonts/gilroy/Gilroy-${name}.ttf`)}") format("truetype");font-weight:${weight};font-style:normal;}`,
    )
    .join("");

/* The app's primary button: an ink pill with paper text. */
const button = ({ href, label }) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 24px;">
  <tr>
    <td align="center" bgcolor="${COLORS.ink}" style="border-radius: 999px;">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 16px 30px; font-family: ${FONT}; font-size: 16px; font-weight: 600; color: ${COLORS.paper}; text-decoration: none;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;

/**
 * A one-time code in the design's ink block, the last three digits in green,
 * spaced wide so it reads aloud and types easily.
 */
const codeBlock = (code) => {
  const value = String(code ?? "");
  const head = value.slice(0, Math.ceil(value.length / 2));
  const tail = value.slice(Math.ceil(value.length / 2));
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px;">
  <tr>
    <td align="center" bgcolor="${COLORS.ink}" style="border-radius: 16px; padding: 24px; font-family: ${FONT}; font-size: 44px; line-height: 1; font-weight: 800; letter-spacing: 0.24em; color: ${COLORS.paper};">${escapeHtml(head)}<span style="color: ${COLORS.green};">${escapeHtml(tail)}</span></td>
  </tr>
</table>`;
};

/** A label/value list, the shape most of these emails need. */
const detailRows = (rows = []) => {
  const cells = rows
    .filter((row) => row && row.value)
    .map(
      (row) => `
      <tr>
        <td style="padding: 10px 0; font-family: ${FONT}; font-size: 14px; color: ${COLORS.muted};">${escapeHtml(row.label)}</td>
        <td align="right" style="padding: 10px 0; font-family: ${FONT}; font-size: 14px; font-weight: 600; color: ${COLORS.ink};">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");

  if (!cells) {
    return "";
  }

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px; border-top: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border};">
  ${cells}
</table>`;
};

/* "Vera · 12 Admiralty Way, Lagos · Help": only the parts that are configured. */
const footerSignature = () =>
  [
    "Vera",
    env.emailPostalAddress ? escapeHtml(env.emailPostalAddress) : null,
    env.emailReplyTo
      ? `<a href="mailto:${escapeHtml(env.emailReplyTo)}" style="color: ${COLORS.link};">Help</a>`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * @param {object} input
 * @param {string} input.previewText Shown next to the subject in the inbox.
 * @param {string} input.heading Lowercase with a full stop, the design's voice: "here's your code."
 * @param {string} input.bodyHtml Already-escaped markup.
 * @param {{href: string, label: string}} [input.cta]
 * @param {string} [input.footerNote] Why this person got it: "Sent to ada@… from a sign-in request."
 */
const renderEmail = ({
  previewText,
  heading,
  bodyHtml,
  cta,
  footerNote,
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(heading)}</title>
<style>${fontFaces()} a{color:${COLORS.link};}</style>
</head>
<body style="margin: 0; padding: 0; background: ${COLORS.page};">
<span style="display: none !important; visibility: hidden; opacity: 0; height: 0; width: 0; overflow: hidden;">${escapeHtml(previewText)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}" style="background: ${COLORS.page}; padding: 40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.card}" style="max-width: 560px; background: ${COLORS.card}; border-radius: 24px; overflow: hidden;">
        <tr>
          <td bgcolor="${COLORS.ink}" style="background: ${COLORS.ink}; padding: 32px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 10px; vertical-align: middle;">
                  <img src="${"https://res.cloudinary.com/dgiropjpp/image/upload/v1793187167/vera-mark-green_gppqkz.svg"}" width="28" height="28" alt="" style="display: block; border: 0;">
                </td>
                <td style="vertical-align: middle; font-family: ${FONT}; font-size: 22px; line-height: 1; font-weight: 800; letter-spacing: -0.04em; color: ${COLORS.paper};">vera</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 40px 16px; font-family: ${FONT}; color: ${COLORS.ink};">
            <h1 style="margin: 0 0 24px; font-family: ${FONT}; font-size: 36px; line-height: 1; font-weight: 800; letter-spacing: -0.045em; color: ${COLORS.ink};">${escapeHtml(heading)}</h1>
            ${bodyHtml}
            ${cta ? button(cta) : ""}
          </td>
        </tr>
        <tr>
          <td style="border-top: 1px solid ${COLORS.border}; padding: 24px 40px; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: ${COLORS.muted};">
            ${footerNote ? `${escapeHtml(footerNote)}<br>` : ""}${footerSignature()}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const paragraph = (html) =>
  `<p style="margin: 0 0 24px; font-family: ${FONT}; font-size: 16px; line-height: 1.55; color: ${COLORS.body};">${html}</p>`;

const muted = (html) =>
  `<p style="margin: 0 0 24px; font-family: ${FONT}; font-size: 14px; line-height: 1.55; color: ${COLORS.body};">${html}</p>`;

/** The plain-text half. Some clients show it, and spam filters expect it. */
const renderText = ({ heading, lines = [], cta, footerNote }) =>
  [
    heading,
    "",
    ...lines.filter(Boolean),
    ...(cta ? ["", `${cta.label}: ${cta.href}`] : []),
    "",
    ...(footerNote ? [footerNote] : []),
    ["Vera", env.emailPostalAddress, env.emailReplyTo]
      .filter(Boolean)
      .join(" · "),
  ].join("\n");

module.exports = {
  COLORS,
  absoluteUrl,
  button,
  codeBlock,
  detailRows,
  escapeHtml,
  formatNaira,
  muted,
  paragraph,
  renderEmail,
  renderText,
};
