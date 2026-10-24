const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateBody, validateParams, validateQuery } = require("../middlewares/validate.middleware");
const { rateLimit } = require("../middlewares/rate-limit.middleware");
const {
  updateVeraSettingsSchema,
  sendVeraMessageSchema,
  listVeraMessagesQuerySchema,
  createHoldSchema,
  createWatchSchema,
  updateWatchSchema,
  idParamsSchema,
} = require("../validations/vera.validation");
const {
  getVeraSettingsController,
  updateVeraSettingsController,
  listVeraMessagesController,
  sendVeraMessageController,
  clearVeraMessagesController,
  listHoldsController,
  createHoldController,
  releaseHoldController,
  listWatchesController,
  createWatchController,
  updateWatchController,
  stopWatchController,
} = require("../controllers/vera.controller");

const router = express.Router();

/* The daily cap is the real limit; this only stops rapid-fire sends hammering the model. */
const sendLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  keyFn: (req) => `vera-send:${req.auth?.userId || req.ip}`,
});

router.use(authMiddleware);

router.get("/settings", getVeraSettingsController);
router.patch("/settings", validateBody(updateVeraSettingsSchema), updateVeraSettingsController);
router.get("/messages", validateQuery(listVeraMessagesQuerySchema), listVeraMessagesController);
router.post("/messages", sendLimit, validateBody(sendVeraMessageSchema), sendVeraMessageController);
router.delete("/messages", clearVeraMessagesController);

/* Holds: tickets set aside for 10 minutes. Holding isn't buying. */
router.get("/holds", listHoldsController);
router.post("/holds", validateBody(createHoldSchema), createHoldController);
router.delete("/holds/:id", validateParams(idParamsSchema), releaseHoldController);

/* Watches: what Vera keeps an eye on while the app is closed. */
router.get("/watches", listWatchesController);
router.post("/watches", validateBody(createWatchSchema), createWatchController);
router.patch("/watches/:id", validateParams(idParamsSchema), validateBody(updateWatchSchema), updateWatchController);
router.delete("/watches/:id", validateParams(idParamsSchema), stopWatchController);

module.exports = router;
