const { absoluteUrl, detailRows, escapeHtml, muted, paragraph, renderEmail, renderText } = require("./layout");

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";

/** "Ada sent you a ticket." With the claim link for someone not on Vera yet. */
const ticketSent = ({ fromName, eventName, eventStartsAt, tierName, quantity, note, token, recipientEmail }) => {
  const heading = `${String(fromName || "Someone").split(" ")[0].toLowerCase()} sent you a ticket.`;
  const href = absoluteUrl(`/claim/${encodeURIComponent(token)}`);
  const what = `${quantity > 1 ? `${quantity} tickets` : "a ticket"} to ${eventName}`;

  return {
    subject: `${fromName || "Someone"} sent you ${what}`,
    html: renderEmail({
      previewText: `Accept it in the Vera app to get your own code.`,
      heading,
      cta: { href, label: "Accept your ticket" },
      footerNote: `Sent to ${recipientEmail}. Only someone signed in to Vera with this email can accept it.`,
      bodyHtml: [
        paragraph(`${escapeHtml(fromName || "Someone")} sent you ${escapeHtml(what)}.`),
        note ? muted(`&ldquo;${escapeHtml(note)}&rdquo;`) : "",
        detailRows([
          { label: "Event", value: eventName },
          { label: "When", value: formatDate(eventStartsAt) },
          { label: "Ticket", value: tierName },
        ]),
        muted("Accept it in the Vera app and it becomes yours, with its own entry code. New to Vera? Sign up with this email address."),
      ].join(""),
    }),
    text: renderText({
      heading,
      cta: { href, label: "Accept your ticket" },
      lines: [
        `${fromName || "Someone"} sent you ${what}.`,
        note ? `"${note}"` : "",
        eventStartsAt ? `When: ${formatDate(eventStartsAt)}` : "",
        "",
        `Only someone signed in to Vera with ${recipientEmail} can accept it.`,
      ],
    }),
  };
};

module.exports = { ticketSent };
