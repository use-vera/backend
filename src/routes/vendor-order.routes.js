const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  cancelOrderBodySchema,
  listMyOrdersQuerySchema,
  orderIdParamsSchema,
  rateOrderBodySchema,
  verifyOrderBodySchema,
} = require("../validations/vendor-order.validation");
const {
  cancelMyOrderController,
  getMyOrderController,
  listMyOrdersController,
  rateOrderController,
  verifyOrderPaymentController,
} = require("../controllers/vendor-order.controller");

/* A buyer's own orders. Placing one lives under its event and vendor; once it
   exists it belongs to the person who bought it. */
const router = express.Router();

router.use(authMiddleware);

router.get("/mine", validateQuery(listMyOrdersQuerySchema), listMyOrdersController);
router.get("/:orderId", validateParams(orderIdParamsSchema), getMyOrderController);
router.post(
  "/:orderId/verify",
  validateParams(orderIdParamsSchema),
  validateBody(verifyOrderBodySchema),
  verifyOrderPaymentController,
);
router.post(
  "/:orderId/cancel",
  validateParams(orderIdParamsSchema),
  validateBody(cancelOrderBodySchema),
  cancelMyOrderController,
);

router.post(
  "/:orderId/rate",
  validateParams(orderIdParamsSchema),
  validateBody(rateOrderBodySchema),
  rateOrderController,
);

module.exports = router;
