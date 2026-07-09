const asyncHandler = require("../utils/async-handler");
const { sendV1Success } = require("../utils/v1-response");
const { listWorkspaceOrders, getWorkspaceOrder } = require("../services/v1-order.service");

const listOrdersController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceOrders({
    workspaceId: req.apiAuth.workspaceId,
    page: req.query.page,
    limit: req.query.limit,
  });

  sendV1Success(res, { data: result.items, meta: result.meta });
});

const getOrderController = asyncHandler(async (req, res) => {
  const result = await getWorkspaceOrder({
    workspaceId: req.apiAuth.workspaceId,
    ticketId: req.params.ticketId,
  });

  sendV1Success(res, { data: result });
});

module.exports = { listOrdersController, getOrderController };
