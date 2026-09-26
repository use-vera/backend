const {
  absoluteUrl,
  detailRows,
  escapeHtml,
  formatNaira,
  muted,
  paragraph,
  renderEmail,
  renderText,
} = require("./layout");

/**
 * The invite conversation between an organizer and a vendor, as email.
 *
 * Each builder returns { subject, html, text } and touches no database and no
 * network, so they can be rendered in a test or previewed in a script. The
 * caller decides who to send to.
 *
 * Shared input shape:
 *   event    { name, startsAtLabel, venue, ticketsSold }
 *   vendor   { businessName }
 *   organizer{ name }
 *   terms    { stallFeeNaira, stallLabel }
 *   links    built here from ids, never passed in as urls
 */

const eventLine = (event) =>
  [event?.startsAtLabel, event?.venue].filter(Boolean).join(" · ");

const termsRows = (terms = {}) => [
  {
    label: "Stall fee",
    value: terms.stallFeeNaira ? formatNaira(terms.stallFeeNaira) : "None",
  },
  { label: "Your stall", value: terms.stallLabel || "" },
];

/** Organizer invited a vendor. Goes to the vendor. */
const vendorInvited = ({ event, vendor, organizer, terms = {}, inviteId }) => {
  const heading = `${organizer.name} wants you at ${event.name}`;
  const cta = {
    href: absoluteUrl(`/vendors/events?invite=${inviteId}`),
    label: "See the invitation",
  };

  return {
    subject: `You're invited to sell at ${event.name}`,
    html: renderEmail({
      previewText: `${organizer.name} invited ${vendor.businessName} to sell at ${event.name}.`,
      heading,
      cta,
      footerNote: "You are getting this because you sell on Vera.",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(vendor.businessName)}, <strong>${escapeHtml(organizer.name)}</strong> has invited you to sell at <strong>${escapeHtml(event.name)}</strong>.`,
        ),
        muted(escapeHtml(eventLine(event))),
        detailRows([
          ...termsRows(terms),
          {
            label: "Tickets sold so far",
            value: event.ticketsSold
              ? Number(event.ticketsSold).toLocaleString("en-NG")
              : "",
          },
        ]),
        muted(
          "Accepting confirms your spot. Nothing is charged until you accept.",
        ),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${organizer.name} has invited ${vendor.businessName} to sell at ${event.name}.`,
        eventLine(event),
        "",
        `Stall fee: ${terms.stallFeeNaira ? formatNaira(terms.stallFeeNaira) : "None"}`,
        terms.stallLabel ? `Your stall: ${terms.stallLabel}` : "",
        "",
        "Nothing is charged until you accept.",
      ],
      cta,
    }),
  };
};

/** Vendor answered an invite. Goes to the organizer. */
const vendorRespondedToInvite = ({
  event,
  vendor,
  accepted,
  declineReason = "",
  eventId,
}) => {
  const heading = accepted
    ? `${vendor.businessName} is in for ${event.name}`
    : `${vendor.businessName} can't make ${event.name}`;
  const cta = {
    href: absoluteUrl(`/organizer/events/${eventId}/vendors`),
    label: "Open your vendors",
  };

  return {
    subject: accepted
      ? `${vendor.businessName} accepted your invitation`
      : `${vendor.businessName} declined your invitation`,
    html: renderEmail({
      previewText: `${vendor.businessName} ${accepted ? "accepted" : "declined"} your invitation to ${event.name}.`,
      heading,
      cta,
      bodyHtml: [
        paragraph(
          accepted
            ? `<strong>${escapeHtml(vendor.businessName)}</strong> accepted your invitation to <strong>${escapeHtml(event.name)}</strong> and their stall is confirmed.`
            : `<strong>${escapeHtml(vendor.businessName)}</strong> declined your invitation to <strong>${escapeHtml(event.name)}</strong>. The spot is open again.`,
        ),
        declineReason
          ? muted(`They said: “${escapeHtml(declineReason)}”`)
          : "",
        muted(escapeHtml(eventLine(event))),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        accepted
          ? `${vendor.businessName} accepted your invitation to ${event.name}.`
          : `${vendor.businessName} declined your invitation to ${event.name}. The spot is open again.`,
        declineReason ? `They said: ${declineReason}` : "",
        eventLine(event),
      ],
      cta,
    }),
  };
};

/** Vendor applied to an event. Goes to the organizer. */
const vendorApplied = ({ event, vendor, eventId }) => {
  const heading = `${vendor.businessName} wants to sell at ${event.name}`;
  const cta = {
    href: absoluteUrl(`/organizer/events/${eventId}/vendors`),
    label: "Review the application",
  };

  return {
    subject: `New vendor application for ${event.name}`,
    html: renderEmail({
      previewText: `${vendor.businessName} applied to sell at ${event.name}.`,
      heading,
      cta,
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(vendor.businessName)}</strong> applied to sell at <strong>${escapeHtml(event.name)}</strong>.`,
        ),
        detailRows([
          { label: "Sells", value: vendor.categoriesLabel || "" },
          { label: "Rating", value: vendor.ratingLabel || "" },
          { label: "Events worked", value: vendor.eventsWorkedLabel || "" },
        ]),
        muted("They see your terms in full before anything is confirmed."),
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        `${vendor.businessName} applied to sell at ${event.name}.`,
        vendor.categoriesLabel ? `Sells: ${vendor.categoriesLabel}` : "",
        vendor.ratingLabel ? `Rating: ${vendor.ratingLabel}` : "",
      ],
      cta,
    }),
  };
};

/** Organizer answered an application. Goes to the vendor. */
const vendorApplicationDecided = ({
  event,
  organizer,
  accepted,
  terms = {},
  inviteId,
}) => {
  const heading = accepted
    ? `You're in for ${event.name}`
    : `${organizer.name} passed on your application`;
  const cta = accepted
    ? {
        href: absoluteUrl(`/vendors/events?invite=${inviteId}`),
        label: "Confirm your spot",
      }
    : { href: absoluteUrl("/vendors/events"), label: "Find another event" };

  return {
    subject: accepted
      ? `Your application for ${event.name} was accepted`
      : `About your application for ${event.name}`,
    html: renderEmail({
      previewText: accepted
        ? `${organizer.name} accepted your application to ${event.name}.`
        : `${organizer.name} could not fit you in at ${event.name}.`,
      heading,
      cta,
      bodyHtml: [
        paragraph(
          accepted
            ? `<strong>${escapeHtml(organizer.name)}</strong> accepted your application to sell at <strong>${escapeHtml(event.name)}</strong>.`
            : `<strong>${escapeHtml(organizer.name)}</strong> could not fit you in at <strong>${escapeHtml(event.name)}</strong> this time. Other events are taking vendors.`,
        ),
        muted(escapeHtml(eventLine(event))),
        accepted ? detailRows(termsRows(terms)) : "",
      ].join(""),
    }),
    text: renderText({
      heading,
      lines: [
        accepted
          ? `${organizer.name} accepted your application to sell at ${event.name}.`
          : `${organizer.name} could not fit you in at ${event.name} this time.`,
        eventLine(event),
      ],
      cta,
    }),
  };
};

module.exports = {
  vendorApplicationDecided,
  vendorApplied,
  vendorInvited,
  vendorRespondedToInvite,
};
