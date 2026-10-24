const asyncHandler = require("../utils/async-handler");
const { getHome, getTrending, listDiscover, getMapPins, getBusiestHours } = require("../services/discover.service");
const {
  discoverListQuerySchema,
  trendingQuerySchema,
  mapPinsQuerySchema,
} = require("../validations/event.validation");

/* Express 5 doesn't let the validator replace req.query, so the parsed and
   typed values are read again here. The route has already rejected bad
   input, so this can't throw on anything that reached it. */
const parsedQuery = (schema, req) => schema.parse(req.query);

/* Home, Discover and the map. */

const respond = (res, message, data) => res.status(200).json({ success: true, message, data });

const getHomeController = asyncHandler(async (req, res) =>
  respond(res, "Home fetched", await getHome({ userId: req.auth.userId })),
);

const getTrendingController = asyncHandler(async (req, res) =>
  respond(res, "Trending fetched", await getTrending({ userId: req.auth.userId, ...parsedQuery(trendingQuerySchema, req) })),
);

const listDiscoverController = asyncHandler(async (req, res) =>
  respond(res, "Events fetched", await listDiscover({ userId: req.auth.userId, ...parsedQuery(discoverListQuerySchema, req) })),
);

const getMapPinsController = asyncHandler(async (req, res) =>
  respond(res, "Pins fetched", await getMapPins({ userId: req.auth.userId, ...parsedQuery(mapPinsQuerySchema, req) })),
);

const getBusiestHoursController = asyncHandler(async (req, res) =>
  respond(res, "Busiest hours fetched", await getBusiestHours({ eventId: req.params.eventId })),
);

module.exports = {
  getHomeController,
  getTrendingController,
  listDiscoverController,
  getMapPinsController,
  getBusiestHoursController,
};
