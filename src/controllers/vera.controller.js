const asyncHandler = require("../utils/async-handler");
const veraService = require("../services/vera.service");
const holdService = require("../services/ticket-hold.service");
const watchService = require("../services/vera-watch.service");
const { listVeraMessagesQuerySchema } = require("../validations/vera.validation");

const getVeraSettingsController = asyncHandler(async (req, res) => {
  const result = await veraService.getSettings({ userId: req.auth.userId });
  res.status(200).json({ success: true, message: "Vera settings fetched", data: result });
});

const updateVeraSettingsController = asyncHandler(async (req, res) => {
  const result = await veraService.updateSettings({ userId: req.auth.userId, patch: req.body });
  res.status(200).json({ success: true, message: "Vera settings updated", data: result });
});

const listVeraMessagesController = asyncHandler(async (req, res) => {
  /* Express 5 won't let validation replace req.query, so parse it here. */
  const { limit } = listVeraMessagesQuerySchema.parse(req.query);
  const result = await veraService.listMessages({ userId: req.auth.userId, limit });
  res.status(200).json({ success: true, message: "Vera messages fetched", data: result });
});

const sendVeraMessageController = asyncHandler(async (req, res) => {
  const result = await veraService.sendMessage({
    userId: req.auth.userId,
    text: req.body.text,
    location: req.body.location,
  });
  res.status(201).json({ success: true, message: "Vera replied", data: result });
});

const clearVeraMessagesController = asyncHandler(async (req, res) => {
  const result = await veraService.clearMessages({ userId: req.auth.userId });
  res.status(200).json({ success: true, message: "Conversation cleared", data: result });
});

const listHoldsController = asyncHandler(async (req, res) => {
  const result = await holdService.listMyHolds({ userId: req.auth.userId });
  res.status(200).json({ success: true, message: "Holds fetched", data: result });
});

const createHoldController = asyncHandler(async (req, res) => {
  const result = req.body.resaleTicketId
    ? await holdService.createResaleHold({ userId: req.auth.userId, resaleTicketId: req.body.resaleTicketId })
    : await holdService.createPrimaryHold({
        userId: req.auth.userId,
        eventId: req.body.eventId,
        ticketCategoryId: req.body.ticketCategoryId,
        quantity: req.body.quantity,
      });
  res.status(201).json({ success: true, message: "Held for 10 minutes", data: result });
});

const releaseHoldController = asyncHandler(async (req, res) => {
  const result = await holdService.releaseHold({ userId: req.auth.userId, holdId: req.params.id });
  res.status(200).json({ success: true, message: "Hold released", data: result });
});

const listWatchesController = asyncHandler(async (req, res) => {
  const result = await watchService.listMyWatches({ userId: req.auth.userId });
  res.status(200).json({ success: true, message: "Watches fetched", data: result });
});

const createWatchController = asyncHandler(async (req, res) => {
  const result = await watchService.createWatch({ userId: req.auth.userId, ...req.body });
  res.status(201).json({ success: true, message: "Vera is watching", data: result });
});

const updateWatchController = asyncHandler(async (req, res) => {
  const result = await watchService.updateWatch({ userId: req.auth.userId, watchId: req.params.id, patch: req.body });
  res.status(200).json({ success: true, message: "Watch updated", data: result });
});

const stopWatchController = asyncHandler(async (req, res) => {
  const result = await watchService.stopWatch({ userId: req.auth.userId, watchId: req.params.id });
  res.status(200).json({ success: true, message: "Watch stopped", data: result });
});

module.exports = {
  listHoldsController,
  createHoldController,
  releaseHoldController,
  listWatchesController,
  createWatchController,
  updateWatchController,
  stopWatchController,
  getVeraSettingsController,
  updateVeraSettingsController,
  listVeraMessagesController,
  sendVeraMessageController,
  clearVeraMessagesController,
};
