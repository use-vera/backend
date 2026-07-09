const asyncHandler = require("../utils/async-handler");
const { sendV1Success } = require("../utils/v1-response");
const {
  listWorkspaceEventsForApi,
  getWorkspaceEventForApi,
  listWorkspaceEventTicketTypesForApi,
} = require("../services/v1-catalog.service");

const listEventsController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceEventsForApi({
    workspaceId: req.apiAuth.workspaceId,
    page: req.query.page,
    limit: req.query.limit,
  });

  sendV1Success(res, { data: result.items, meta: result.meta });
});

const getEventController = asyncHandler(async (req, res) => {
  const result = await getWorkspaceEventForApi({
    workspaceId: req.apiAuth.workspaceId,
    eventId: req.params.eventId,
  });

  sendV1Success(res, { data: result });
});

const listEventTicketTypesController = asyncHandler(async (req, res) => {
  const result = await listWorkspaceEventTicketTypesForApi({
    workspaceId: req.apiAuth.workspaceId,
    eventId: req.params.eventId,
  });

  sendV1Success(res, { data: result });
});

module.exports = {
  listEventsController,
  getEventController,
  listEventTicketTypesController,
};
