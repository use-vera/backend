const { detailRows, escapeHtml, formatNaira, muted, paragraph, renderEmail, renderText } = require("./layout");

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

const describeMethod = (method) => {
  if (!method) return "";
  if (method.last4) return `${method.brand ? `${method.brand} ` : "Card "}•• ${method.last4}`.trim();
  return method.bank || method.channel || "";
};

/**
 * A ticket receipt, built from getTicketReceipt's output. Pure: returns
 * { subject, html, text } and sends nothing.
 */
const ticketReceipt = ({ receipt }) => {
  const eventName = receipt.event?.name || "your event";
  const heading = "your receipt.";
  const allLines = [...receipt.lines, ...receipt.upgrades];
  const total = receipt.grandTotalNaira;

  const lineRows = allLines.map((line) => ({
    label: line.label,
    value: line.amountNaira < 0 ? `−${formatNaira(-line.amountNaira)}` : formatNaira(line.amountNaira),
  }));

  return {
    subject: `Receipt ${receipt.receiptNumber} · ${eventName}`,
    html: renderEmail({
      previewText: `${formatNaira(total)} paid for ${eventName}.`,
      heading,
      footerNote: `Receipt ${receipt.receiptNumber}. Keep it for your records.`,
      bodyHtml: [
        paragraph(
          `${formatNaira(total)} paid for <strong>${escapeHtml(eventName)}</strong>${
            receipt.event?.startsAt ? ` on ${escapeHtml(formatDate(receipt.event.startsAt))}` : ""
          }.`,
        ),
        detailRows([...lineRows, { label: "Total", value: formatNaira(total) }]),
        detailRows([
          { label: "Receipt", value: receipt.receiptNumber },
          { label: "Paid on", value: formatDate(receipt.paidAt) },
          { label: "Method", value: describeMethod(receipt.method) },
          { label: "Reference", value: receipt.reference },
          { label: "Billed to", value: [receipt.billedTo.name, receipt.billedTo.email].filter(Boolean).join(" · ") },
          { label: "Sold by", value: receipt.event?.organizerName ? `${receipt.event.organizerName} through Vera` : "" },
        ]),
        receipt.refundedNaira > 0
          ? muted(`${formatNaira(receipt.refundedNaira)} of this order was refunded on ${escapeHtml(formatDate(receipt.refundedAt))}.`)
          : "",
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${formatNaira(total)} paid for ${eventName}.`,
        "",
        ...lineRows.map((row) => `${row.label}: ${row.value}`),
        `Total: ${formatNaira(total)}`,
        "",
        `Receipt: ${receipt.receiptNumber}`,
        receipt.paidAt ? `Paid on: ${formatDate(receipt.paidAt)}` : "",
        receipt.method ? `Method: ${describeMethod(receipt.method)}` : "",
        `Reference: ${receipt.reference}`,
      ],
    }),
  };
};

module.exports = { ticketReceipt };
