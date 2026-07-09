// Shared curated DTOs for the /v1 Developer Platform API — kept separate
// from the internal API's response shapes (mapEventForResponse etc.) so the
// public API surface never leaks internal fields and can evolve
// independently.

const mapOrderTicket = (ticket) => ({
  id: String(ticket._id),
  eventId: String(ticket.eventId?._id || ticket.eventId),
  status: ticket.status,
  quantity: ticket.quantity,
  unitPriceNaira: ticket.unitPriceNaira,
  totalPriceNaira: ticket.totalPriceNaira,
  currency: ticket.currency,
  ticketCode: ticket.ticketCode,
  attendeeName: ticket.attendeeName,
  attendeeEmail: ticket.attendeeEmail,
  checkedIn: ticket.status === "used",
  checkedInAt: ticket.usedAt || null,
  purchasedAt: ticket.paidAt || null,
  createdAt: ticket.createdAt,
});

const mapPublicEvent = ({ event, salePhase, remainingTickets, soldTickets, ticketTypes }) => ({
  id: String(event._id),
  name: event.name,
  description: event.description,
  imageUrl: event.imageUrl || "",
  address: event.address,
  state: event.state || "",
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  timezone: event.timezone,
  isPaid: event.isPaid,
  currency: event.currency,
  salePhase,
  remainingTickets,
  soldTickets,
  ...(ticketTypes ? { ticketTypes } : {}),
});

module.exports = { mapOrderTicket, mapPublicEvent };
