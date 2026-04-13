const asyncHandler = require("../utils/async-handler");
const {
  getEventBranding,
  updateEventBranding,
  listEventCampaigns,
  createEventCampaign,
  getEventCampaignById,
  updateEventCampaignSchedule,
  listEventExports,
  createEventExport,
  getEventExportById,
  getEventExportPreview,
  getEventExportDownload,
} = require("../services/event-premium.service");

const getEventBrandingController = asyncHandler(async (req, res) => {
  const data = await getEventBranding({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Event branding fetched",
    data,
  });
});

const updateEventBrandingController = asyncHandler(async (req, res) => {
  const data = await updateEventBranding({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Event branding updated",
    data,
  });
});

const listEventCampaignsController = asyncHandler(async (req, res) => {
  const data = await listEventCampaigns({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    query: req.query,
  });

  res.status(200).json({
    success: true,
    message: "Event campaigns fetched",
    data,
  });
});

const createEventCampaignController = asyncHandler(async (req, res) => {
  const data = await createEventCampaign({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Campaign created",
    data,
  });
});

const getEventCampaignController = asyncHandler(async (req, res) => {
  const data = await getEventCampaignById({
    eventId: req.params.eventId,
    campaignId: req.params.campaignId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Campaign fetched",
    data,
  });
});

const updateEventCampaignController = asyncHandler(async (req, res) => {
  const data = await updateEventCampaignSchedule({
    eventId: req.params.eventId,
    campaignId: req.params.campaignId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Campaign updated",
    data,
  });
});

const listEventExportsController = asyncHandler(async (req, res) => {
  const data = await listEventExports({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    query: req.query,
  });

  res.status(200).json({
    success: true,
    message: "Event exports fetched",
    data,
  });
});

const createEventExportController = asyncHandler(async (req, res) => {
  const data = await createEventExport({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Export generated",
    data,
  });
});

const getEventExportController = asyncHandler(async (req, res) => {
  const data = await getEventExportById({
    eventId: req.params.eventId,
    exportId: req.params.exportId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Export fetched",
    data,
  });
});

const getEventExportPreviewController = asyncHandler(async (req, res) => {
  const data = await getEventExportPreview({
    eventId: req.params.eventId,
    exportId: req.params.exportId,
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: "Export preview fetched",
    data,
  });
});

const downloadEventExportController = asyncHandler(async (req, res) => {
  const exportJob = await getEventExportDownload({
    eventId: req.params.eventId,
    exportId: req.params.exportId,
    actorUserId: req.auth.userId,
  });

  res.setHeader("Content-Type", exportJob.mimeType || "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"${exportJob.fileName || "event-export.csv"}\"`,
  );
  res.status(200).send(exportJob.content || "");
});

module.exports = {
  getEventBrandingController,
  updateEventBrandingController,
  listEventCampaignsController,
  createEventCampaignController,
  getEventCampaignController,
  updateEventCampaignController,
  listEventExportsController,
  createEventExportController,
  getEventExportController,
  getEventExportPreviewController,
  downloadEventExportController,
};
