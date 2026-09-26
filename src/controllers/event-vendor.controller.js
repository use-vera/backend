const asyncHandler = require("../utils/async-handler");
const eventVendorService = require("../services/event-vendor.service");

/* Organizer side: mounted under an event, so the event id is the route's. */

const updateVendorSettingsController = asyncHandler(async (req, res) => {
  const data = await eventVendorService.updateVendorSettings({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Vendor settings updated",
    data,
  });
});

const listEventVendorsController = asyncHandler(async (req, res) => {
  const data = await eventVendorService.listEventVendors({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Event vendors fetched",
    data,
  });
});

const inviteVendorController = asyncHandler(async (req, res) => {
  const booking = await eventVendorService.inviteVendor({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Invitation sent",
    data: { booking },
  });
});

const decideApplicationController = asyncHandler(async (req, res) => {
  const booking = await eventVendorService.decideApplication({
    eventId: req.params.eventId,
    bookingId: req.params.bookingId,
    actorUserId: req.auth.userId,
    accept: req.body.accept,
    terms: req.body.terms,
  });

  res.status(200).json({
    success: true,
    message: req.body.accept ? "Application accepted" : "Application declined",
    data: { booking },
  });
});

const removeVendorController = asyncHandler(async (req, res) => {
  const booking = await eventVendorService.removeVendorFromEvent({
    eventId: req.params.eventId,
    bookingId: req.params.bookingId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Vendor removed from this event",
    data: { booking },
  });
});

/* Vendor side: mounted under /vendors/me, so the vendor is the caller's. */

const applyToEventController = asyncHandler(async (req, res) => {
  const booking = await eventVendorService.applyToEvent({
    eventId: req.body.eventId,
    actorUserId: req.auth.userId,
    message: req.body.message,
  });

  res.status(201).json({
    success: true,
    message: "Application sent",
    data: { booking },
  });
});

const respondToInviteController = asyncHandler(async (req, res) => {
  const result = await eventVendorService.respondToInvite({
    bookingId: req.params.bookingId,
    actorUserId: req.auth.userId,
    accept: req.body.accept,
    note: req.body.note,
    callbackUrl: req.body.callbackUrl,
  });

  res.status(200).json({
    success: true,
    message: result.requiresPayment
      ? "Pay the stall fee to confirm your spot"
      : req.body.accept
        ? "Invitation accepted"
        : "Invitation declined",
    data: result,
  });
});

const verifyStallFeeController = asyncHandler(async (req, res) => {
  const booking = await eventVendorService.verifyStallFee({
    bookingId: req.params.bookingId,
    actorUserId: req.auth.userId,
    reference: req.body.reference,
  });

  res.status(200).json({
    success: true,
    message: "Stall fee paid. Your spot is confirmed.",
    data: { booking },
  });
});

const listMyBookingsController = asyncHandler(async (req, res) => {
  const data = await eventVendorService.listMyBookings({
    actorUserId: req.auth.userId,
    status: req.query.status,
  });

  res.status(200).json({
    success: true,
    message: "Bookings fetched",
    data,
  });
});

const listOpenEventsController = asyncHandler(async (req, res) => {
  const data = await eventVendorService.listOpenEvents({
    actorUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Events fetched",
    data,
  });
});

module.exports = {
  applyToEventController,
  decideApplicationController,
  inviteVendorController,
  listEventVendorsController,
  listMyBookingsController,
  listOpenEventsController,
  removeVendorController,
  respondToInviteController,
  updateVendorSettingsController,
  verifyStallFeeController,
};
