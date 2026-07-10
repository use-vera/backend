const asyncHandler = require("../utils/async-handler");
const { listPublicEvents, getPublicEventById } = require("../services/event.service");

const listPublicEventsController = asyncHandler(async (req, res) => {
  const result = await listPublicEvents({
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    sort: req.query.sort,
    filter: req.query.filter,
    from: req.query.from,
    to: req.query.to,
    ticketType: req.query.ticketType,
    state: req.query.state,
    category: req.query.category,
    nearLat: req.query.nearLat,
    nearLng: req.query.nearLng,
    nearRadiusKm: req.query.nearRadiusKm,
  });

  res.status(200).json({
    success: true,
    message: "Events fetched",
    data: result,
  });
});

const getPublicEventController = asyncHandler(async (req, res) => {
  const result = await getPublicEventById({
    eventId: req.params.eventId,
  });

  res.status(200).json({
    success: true,
    message: "Event fetched",
    data: result,
  });
});

module.exports = {
  listPublicEventsController,
  getPublicEventController,
};
