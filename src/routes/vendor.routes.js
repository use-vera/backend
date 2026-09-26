const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const requireAdmin = require("../middlewares/require-admin.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  createItemBodySchema,
  createVendorBodySchema,
  itemIdParamsSchema,
  listVendorsQuerySchema,
  reorderItemsBodySchema,
  reorderSectionsBodySchema,
  reviewVerificationBodySchema,
  sectionBodySchema,
  sectionIdParamsSchema,
  updateItemBodySchema,
  updateVendorBodySchema,
  submitVerificationBodySchema,
  vendorIdParamsSchema,
  vendorSlugParamsSchema,
  vendorStatusBodySchema,
} = require("../validations/vendor.validation");
const {
  addSectionController,
  createItemController,
  createVendorController,
  deleteItemController,
  deleteSectionController,
  getMyLimitsController,
  getMyMenuController,
  getMyVendorController,
  getPublicVendorMenuController,
  listVendorCategoriesController,
  listVendorsController,
  renameSectionController,
  reorderItemsController,
  reviewVerificationController,
  setVendorStatusController,
  submitVerificationController,
  reorderSectionsController,
  updateItemController,
  updateVendorController,
} = require("../controllers/vendor.controller");

const {
  applyToEventBodySchema,
  listBookingsQuerySchema,
  listOpenEventsQuerySchema,
  respondToInviteBodySchema,
  vendorBookingIdParamsSchema,
  verifyStallFeeBodySchema,
} = require("../validations/event-vendor.validation");
const {
  applyToEventController,
  listMyBookingsController,
  listOpenEventsController,
  respondToInviteController,
  verifyStallFeeController,
} = require("../controllers/event-vendor.controller");

const {
  advanceOrderBodySchema,
  bookingIdParamsSchema: orderBookingIdParamsSchema,
  cancelOrderBodySchema,
  collectOrderBodySchema,
  listVendorOrdersQuerySchema,
  orderIdParamsSchema,
  serviceStateBodySchema,
} = require("../validations/vendor-order.validation");
const {
  advanceOrderController,
  cancelVendorOrderController,
  collectOrderController,
  listVendorOrdersController,
  updateServiceStateController,
} = require("../controllers/vendor-order.controller");

const router = express.Router();

/* The category list is the same for everyone and gives nothing away, so it
   stays readable while signed out: the sign-up form needs it before there is
   an account. */
router.get("/categories", listVendorCategoriesController);

router.use(authMiddleware);

/* "me" first: a literal segment must not be caught by a slug route below. */
router.get("/me", getMyVendorController);
router.post("/me", validateBody(createVendorBodySchema), createVendorController);
router.patch("/me", validateBody(updateVendorBodySchema), updateVendorController);

router.get("/me/menu", getMyMenuController);

/* --- how much they may sell, and the one thing that lifts it --- */
router.get("/me/limits", getMyLimitsController);
router.post(
  "/me/verification",
  validateBody(submitVerificationBodySchema),
  submitVerificationController,
);

router.post(
  "/me/sections",
  validateBody(sectionBodySchema),
  addSectionController,
);
router.patch(
  "/me/sections/order",
  validateBody(reorderSectionsBodySchema),
  reorderSectionsController,
);
router.patch(
  "/me/sections/:sectionId",
  validateParams(sectionIdParamsSchema),
  validateBody(sectionBodySchema),
  renameSectionController,
);
router.delete(
  "/me/sections/:sectionId",
  validateParams(sectionIdParamsSchema),
  deleteSectionController,
);

router.post("/me/items", validateBody(createItemBodySchema), createItemController);
router.patch(
  "/me/items/order",
  validateBody(reorderItemsBodySchema),
  reorderItemsController,
);
router.patch(
  "/me/items/:itemId",
  validateParams(itemIdParamsSchema),
  validateBody(updateItemBodySchema),
  updateItemController,
);
router.delete(
  "/me/items/:itemId",
  validateParams(itemIdParamsSchema),
  deleteItemController,
);

/* --- this vendor's events --- */
router.get(
  "/me/bookings",
  validateQuery(listBookingsQuerySchema),
  listMyBookingsController,
);
router.post(
  "/me/bookings",
  validateBody(applyToEventBodySchema),
  applyToEventController,
);
router.patch(
  "/me/bookings/:bookingId/response",
  validateParams(vendorBookingIdParamsSchema),
  validateBody(respondToInviteBodySchema),
  respondToInviteController,
);
router.post(
  "/me/bookings/:bookingId/stall-fee/verify",
  validateParams(vendorBookingIdParamsSchema),
  validateBody(verifyStallFeeBodySchema),
  verifyStallFeeController,
);
router.get(
  "/me/open-events",
  validateQuery(listOpenEventsQuerySchema),
  listOpenEventsController,
);

/* --- tonight's queue --- */
router.get(
  "/me/orders",
  validateQuery(listVendorOrdersQuerySchema),
  listVendorOrdersController,
);
router.patch(
  "/me/orders/:orderId/status",
  validateParams(orderIdParamsSchema),
  validateBody(advanceOrderBodySchema),
  advanceOrderController,
);
router.post(
  "/me/orders/:orderId/collect",
  validateParams(orderIdParamsSchema),
  validateBody(collectOrderBodySchema),
  collectOrderController,
);
router.post(
  "/me/orders/:orderId/cancel",
  validateParams(orderIdParamsSchema),
  validateBody(cancelOrderBodySchema),
  cancelVendorOrderController,
);
router.patch(
  "/me/bookings/:bookingId/service",
  validateParams(orderBookingIdParamsSchema),
  validateBody(serviceStateBodySchema),
  updateServiceStateController,
);

/* --- platform admin: decisions about a vendor, not by a vendor --- */
router.patch(
  "/:vendorId/verification",
  requireAdmin,
  validateParams(vendorIdParamsSchema),
  validateBody(reviewVerificationBodySchema),
  reviewVerificationController,
);
router.patch(
  "/:vendorId/status",
  requireAdmin,
  validateParams(vendorIdParamsSchema),
  validateBody(vendorStatusBodySchema),
  setVendorStatusController,
);

/* The directory organizers search. One vendor's page is public and lives on
   public-vendor.routes.js, because this router is behind auth. */
router.get("/", validateQuery(listVendorsQuerySchema), listVendorsController);
router.get(
  "/:slug",
  validateParams(vendorSlugParamsSchema),
  getPublicVendorMenuController,
);

module.exports = router;
