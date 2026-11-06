const { detailRows, escapeHtml, formatNaira, muted, paragraph, renderEmail, renderText } = require("./layout");

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

const bankLine = (bankName, last4) => [bankName || "your bank", last4 ? `•• ${last4}` : null].filter(Boolean).join(" ");

/* We can't promise a bank's speed, only say it varies. */
const REFUND_TIMING = "It can take a few working days to show, depending on your bank.";

/**
 * An event someone held a ticket to was cancelled, sent once their refund
 * has gone out, so it can say exactly what's coming back.
 */
const eventCancelled = ({ eventName, startsAt, organizerName, reason, refundNaira, email }) => {
  const heading = "this one's off.";
  const refunded = Number(refundNaira) > 0;

  return {
    subject: `${eventName} is cancelled${refunded ? ", and your refund is on its way" : ""}`,
    html: renderEmail({
      previewText: refunded ? `${formatNaira(refundNaira)} is on its way back to you.` : "Your ticket has been cancelled.",
      heading,
      footerNote: email ? `Sent to ${email} because you held a ticket to this event.` : undefined,
      bodyHtml: [
        paragraph(
          `${organizerName ? `${escapeHtml(organizerName)} cancelled` : "The host cancelled"} <strong>${escapeHtml(eventName)}</strong>${
            startsAt ? `, which was on ${escapeHtml(formatWhen(startsAt))}` : ""
          }.`,
        ),
        reason ? muted(`Their note: “${escapeHtml(reason)}”`) : "",
        refunded
          ? paragraph(`${formatNaira(refundNaira)} is on its way back to the card or account you paid with. ${REFUND_TIMING}`)
          : paragraph("Your ticket was free, so there's nothing to refund."),
        detailRows([
          { label: "Event", value: eventName },
          { label: "Was on", value: formatWhen(startsAt) },
          { label: "Refund", value: refunded ? formatNaira(refundNaira) : "" },
        ]),
        muted("Sorry this one didn't happen. There's plenty else on in Vera."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${organizerName || "The host"} cancelled ${eventName}${startsAt ? `, which was on ${formatWhen(startsAt)}` : ""}.`,
        reason ? `Their note: "${reason}"` : "",
        refunded
          ? `${formatNaira(refundNaira)} is on its way back to the card or account you paid with. ${REFUND_TIMING}`
          : "Your ticket was free, so there's nothing to refund.",
      ],
    }),
  };
};

/** A refund for any other reason: the host refunded a ticket, or a resale was undone. */
const refundIssued = ({ eventName, refundNaira, reason, what = "your ticket", email }) => {
  const heading = "your refund is on its way.";

  return {
    subject: `Your ${formatNaira(refundNaira)} refund for ${eventName}`,
    html: renderEmail({
      previewText: `${formatNaira(refundNaira)} is on its way back to you.`,
      heading,
      footerNote: email ? `Sent to ${email}. Keep this for your records.` : undefined,
      bodyHtml: [
        paragraph(`We've refunded ${escapeHtml(what)} for <strong>${escapeHtml(eventName)}</strong>.`),
        detailRows([
          { label: "Refund", value: formatNaira(refundNaira) },
          { label: "Event", value: eventName },
          { label: "Reason", value: reason },
        ]),
        paragraph(`It's going back to the card or account you paid with. ${REFUND_TIMING}`),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `We've refunded ${what} for ${eventName}.`,
        `Refund: ${formatNaira(refundNaira)}`,
        reason ? `Reason: ${reason}` : "",
        "",
        `It's going back to the card or account you paid with. ${REFUND_TIMING}`,
      ],
    }),
  };
};

/** A wallet withdrawal reached the bank. */
const withdrawalSent = ({ amountNaira, bankName, last4, reference, sentAt, email }) => {
  const heading = "your money's on its way.";

  return {
    subject: `${formatNaira(amountNaira)} is on its way to your bank`,
    html: renderEmail({
      previewText: `Sent to ${bankLine(bankName, last4)}.`,
      heading,
      footerNote: email ? `Sent to ${email}. Keep this for your records.` : undefined,
      bodyHtml: [
        paragraph(`${formatNaira(amountNaira)} has left your Vera wallet for ${escapeHtml(bankLine(bankName, last4))}.`),
        detailRows([
          { label: "Amount", value: formatNaira(amountNaira) },
          { label: "To", value: bankLine(bankName, last4) },
          { label: "Sent", value: formatWhen(sentAt) },
          { label: "Reference", value: reference },
        ]),
        muted("Most transfers land within minutes. Some banks take longer."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${formatNaira(amountNaira)} has left your Vera wallet for ${bankLine(bankName, last4)}.`,
        reference ? `Reference: ${reference}` : "",
        "Most transfers land within minutes. Some banks take longer.",
      ],
    }),
  };
};

/** A withdrawal the bank or Paystack turned back. The money is in the wallet again. */
const withdrawalFailed = ({ amountNaira, email }) => {
  const heading = "your withdrawal didn't go through.";

  return {
    subject: `Your ${formatNaira(amountNaira)} withdrawal didn't go through`,
    html: renderEmail({
      previewText: "The money is back in your Vera wallet.",
      heading,
      footerNote: email ? `Sent to ${email}.` : undefined,
      bodyHtml: [
        paragraph(`${formatNaira(amountNaira)} couldn't be sent, so it's back in your Vera wallet. Nothing is lost.`),
        paragraph("Check your bank details in Vera, under You, then Wallet, then Payout account, and try again."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${formatNaira(amountNaira)} couldn't be sent, so it's back in your Vera wallet. Nothing is lost.`,
        "Check your bank details in Vera (You > Wallet > Payout account) and try again.",
      ],
    }),
  };
};

/** A ticket you listed for resale sold. Paid out after the event. */
const resaleSold = ({ eventName, amountNaira, quantity, payoutDelayHours, email }) => {
  const heading = "your ticket sold.";
  const what = quantity > 1 ? `${quantity} tickets` : "Your ticket";

  return {
    subject: `${what} to ${eventName} sold for ${formatNaira(amountNaira)}`,
    html: renderEmail({
      previewText: `Paid to your bank ${payoutDelayHours} hours after the event.`,
      heading,
      footerNote: email ? `Sent to ${email} because you listed this ticket for resale.` : undefined,
      bodyHtml: [
        paragraph(`${escapeHtml(what)} to <strong>${escapeHtml(eventName)}</strong> sold for ${formatNaira(amountNaira)}.`),
        paragraph(
          `We pay it to your bank ${payoutDelayHours} hours after the event, so there's time to sort out anything that goes wrong at the door.`,
        ),
        muted("No bank account on Vera yet? Add one under You, then Wallet, so the money has somewhere to go."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${what} to ${eventName} sold for ${formatNaira(amountNaira)}.`,
        `We pay it to your bank ${payoutDelayHours} hours after the event.`,
      ],
    }),
  };
};

/** The resale money was sent to the seller's bank. */
const resalePayoutPaid = ({ amountNaira, bankName, last4, email }) => {
  const heading = "your resale money is on its way.";

  return {
    subject: `${formatNaira(amountNaira)} from your resale is on its way`,
    html: renderEmail({
      previewText: `Sent to ${bankLine(bankName, last4)}.`,
      heading,
      footerNote: email ? `Sent to ${email}. Keep this for your records.` : undefined,
      bodyHtml: [
        paragraph(`${formatNaira(amountNaira)} from your ticket resale was sent to ${escapeHtml(bankLine(bankName, last4))}.`),
        muted("Most transfers land within minutes. Some banks take longer."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [`${formatNaira(amountNaira)} from your ticket resale was sent to ${bankLine(bankName, last4)}.`],
    }),
  };
};

/** Resale money is ready but there's no verified bank account to send it to. */
const resalePayoutNeedsAccount = ({ amountNaira, email }) => {
  const heading = "add your bank to get paid.";

  return {
    subject: `${formatNaira(amountNaira)} from your resale is waiting for you`,
    html: renderEmail({
      previewText: "Add your bank details and we'll send it.",
      heading,
      footerNote: email ? `Sent to ${email} because you have resale money waiting.` : undefined,
      bodyHtml: [
        paragraph(`${formatNaira(amountNaira)} from your ticket resale is ready, but we don't have a bank account to send it to.`),
        paragraph("Open Vera, go to You, then Wallet, then Payout account, and add your bank. We'll send it as soon as it's verified."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${formatNaira(amountNaira)} from your ticket resale is ready, but we don't have a bank account to send it to.`,
        "In Vera, go to You > Wallet > Payout account and add your bank.",
      ],
    }),
  };
};

module.exports = {
  eventCancelled,
  refundIssued,
  withdrawalSent,
  withdrawalFailed,
  resaleSold,
  resalePayoutPaid,
  resalePayoutNeedsAccount,
};
