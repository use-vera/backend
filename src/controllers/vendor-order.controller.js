const asyncHandler = require("../utils/async-handler");
const vendorOrderService = require("../services/vendor-order.service");

const ok = (res, message, data, status = 200) =>
  res.status(status).json({ success: true, message, data });

/* --- buyers --- */

const listEventVendorsForBuyersController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.listEventVendorsForBuyers({
    eventId: req.params.eventId,
    actorUserId: req.auth.userId,
  });

  ok(res, "Vendors fetched", data);
});

const getVendorMenuForBuyersController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.getVendorMenuForBuyers({
    eventId: req.params.eventId,
    vendorId: req.params.vendorId,
    actorUserId: req.auth.userId,
  });

  ok(res, "Menu fetched", data);
});

const placeOrderController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.placeOrder({
    eventId: req.params.eventId,
    vendorId: req.params.vendorId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  ok(res, data.requiresPayment ? "Order started" : "Order placed", data, 201);
});

const verifyOrderPaymentController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.verifyOrderPayment({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    reference: req.body.reference,
  });

  ok(res, "Payment confirmed", { order });
});

const listMyOrdersController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.listMyOrders({
    actorUserId: req.auth.userId,
    eventId: req.query.eventId,
    live: req.query.live,
  });

  ok(res, "Orders fetched", data);
});

const getMyOrderController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.getMyOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
  });

  ok(res, "Order fetched", { order });
});

const cancelMyOrderController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.cancelOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    reason: req.body.reason,
    byVendor: false,
  });

  ok(res, "Order cancelled", { order });
});

const rateOrderController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.rateOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    rating: req.body.rating,
    comment: req.body.comment,
  });

  ok(res, "Thanks for rating", data, 201);
});

/* --- vendors --- */

const listVendorOrdersController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.listVendorOrders({
    actorUserId: req.auth.userId,
    eventId: req.query.eventId,
    status: req.query.status,
  });

  ok(res, "Orders fetched", data);
});

const advanceOrderController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.advanceOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    status: req.body.status,
  });

  ok(res, `Order marked ${req.body.status}`, { order });
});

const collectOrderController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.collectOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    code: req.body.code,
  });

  ok(res, "Order handed over", { order });
});

const cancelVendorOrderController = asyncHandler(async (req, res) => {
  const order = await vendorOrderService.cancelOrder({
    orderId: req.params.orderId,
    actorUserId: req.auth.userId,
    reason: req.body.reason,
    byVendor: true,
  });

  ok(res, "Order cancelled and refunded", { order });
});

const updateServiceStateController = asyncHandler(async (req, res) => {
  const data = await vendorOrderService.updateServiceState({
    bookingId: req.params.bookingId,
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  ok(res, "Updated", data);
});

module.exports = {
  advanceOrderController,
  cancelMyOrderController,
  cancelVendorOrderController,
  collectOrderController,
  getMyOrderController,
  getVendorMenuForBuyersController,
  listEventVendorsForBuyersController,
  listMyOrdersController,
  listVendorOrdersController,
  placeOrderController,
  rateOrderController,
  updateServiceStateController,
  verifyOrderPaymentController,
};
