const asyncHandler = require("../utils/async-handler");
const {
  getEventPage,
  saveEventPage,
  setEventPageStatus,
  checkSlug,
  getPublicEventPage,
} = require("../services/event-page.service");

const getEventPageController = asyncHandler(async (req, res) => {
  const result = await getEventPage({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.json({ success: true, message: "Event page", data: result });
});

const saveEventPageController = asyncHandler(async (req, res) => {
  const page = await saveEventPage({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.json({ success: true, message: "Page saved", data: page });
});

const setEventPageStatusController = asyncHandler(async (req, res) => {
  const page = await setEventPageStatus({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    status: req.body.status,
  });

  res.json({
    success: true,
    message: page.status === "published" ? "Page published" : "Page unpublished",
    data: page,
  });
});

const checkSlugController = asyncHandler(async (req, res) => {
  const result = await checkSlug({
    slug: req.query.slug,
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.json({ success: true, message: "Address checked", data: result });
});

/** Public. No auth. This is the front door. */
const getPublicEventPageController = asyncHandler(async (req, res) => {
  const result = await getPublicEventPage({ slug: req.params.slug });

  res.json({ success: true, message: "Event page", data: result });
});

module.exports = {
  getEventPageController,
  saveEventPageController,
  setEventPageStatusController,
  checkSlugController,
  getPublicEventPageController,
};
