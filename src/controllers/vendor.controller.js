const asyncHandler = require("../utils/async-handler");
const { listVendorCategories } = require("../constants/vendor-categories");
const vendorService = require("../services/vendor.service");

/* Controllers take the acting user from req.auth and nothing else: a vendor id
   in a body or a query is never what decides whose menu gets written. */

const listVendorCategoriesController = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Vendor categories fetched",
    data: { items: listVendorCategories() },
  });
});

const getMyVendorController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.getMyVendor({
    actorUserId: req.auth.userId,
  });

  res.status(200).json({
    success: true,
    message: vendor ? "Vendor fetched" : "No vendor account yet",
    data: { vendor },
  });
});

const createVendorController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.createVendor({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Vendor account created",
    data: { vendor },
  });
});

const updateVendorController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.updateVendor({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Vendor updated",
    data: { vendor },
  });
});

const getMyLimitsController = asyncHandler(async (req, res) => {
  const data = await vendorService.getMyLimits({ actorUserId: req.auth.userId });

  res.status(200).json({
    success: true,
    message: "Limits fetched",
    data,
  });
});

const submitVerificationController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.submitVerification({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(202).json({
    success: true,
    message: "Sent for review. We'll let you know as soon as it's checked.",
    data: { vendor },
  });
});

const reviewVerificationController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.reviewVendorVerification({
    vendorId: req.params.vendorId,
    approve: req.body.approve,
    level: req.body.level,
    note: req.body.note,
  });

  res.status(200).json({
    success: true,
    message: req.body.approve ? "Vendor verified" : "Submission rejected",
    data: { vendor },
  });
});

const setVendorStatusController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.setVendorStatus({
    vendorId: req.params.vendorId,
    status: req.body.status,
    note: req.body.note,
  });

  res.status(200).json({
    success: true,
    message: req.body.status === "suspended" ? "Vendor suspended" : "Vendor reinstated",
    data: { vendor },
  });
});

const getMyMenuController = asyncHandler(async (req, res) => {
  const menu = await vendorService.getMyMenu({ actorUserId: req.auth.userId });

  res.status(200).json({
    success: true,
    message: "Menu fetched",
    data: menu,
  });
});

const addSectionController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.addSection({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Section added",
    data: { vendor },
  });
});

const renameSectionController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.renameSection({
    actorUserId: req.auth.userId,
    sectionId: req.params.sectionId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Section renamed",
    data: { vendor },
  });
});

const deleteSectionController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.deleteSection({
    actorUserId: req.auth.userId,
    sectionId: req.params.sectionId,
  });

  res.status(200).json({
    success: true,
    message: "Section removed. Its items moved to your default heading.",
    data: { vendor },
  });
});

const reorderSectionsController = asyncHandler(async (req, res) => {
  const vendor = await vendorService.reorderSections({
    actorUserId: req.auth.userId,
    sectionIds: req.body.sectionIds,
  });

  res.status(200).json({
    success: true,
    message: "Sections reordered",
    data: { vendor },
  });
});

const createItemController = asyncHandler(async (req, res) => {
  const item = await vendorService.createItem({
    actorUserId: req.auth.userId,
    payload: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Item added",
    data: { item },
  });
});

const updateItemController = asyncHandler(async (req, res) => {
  const item = await vendorService.updateItem({
    actorUserId: req.auth.userId,
    itemId: req.params.itemId,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: "Item updated",
    data: { item },
  });
});

const deleteItemController = asyncHandler(async (req, res) => {
  const result = await vendorService.deleteItem({
    actorUserId: req.auth.userId,
    itemId: req.params.itemId,
  });

  res.status(200).json({
    success: true,
    message: "Item removed",
    data: result,
  });
});

const reorderItemsController = asyncHandler(async (req, res) => {
  const result = await vendorService.reorderItems({
    actorUserId: req.auth.userId,
    itemIds: req.body.itemIds,
  });

  res.status(200).json({
    success: true,
    message: "Items reordered",
    data: result,
  });
});

const listVendorsController = asyncHandler(async (req, res) => {
  const result = await vendorService.listVendors(req.query);

  res.status(200).json({
    success: true,
    message: "Vendors fetched",
    data: result,
  });
});

const getPublicVendorMenuController = asyncHandler(async (req, res) => {
  const menu = await vendorService.getPublicVendorMenu({
    slug: req.params.slug,
  });

  res.status(200).json({
    success: true,
    message: "Vendor menu fetched",
    data: menu,
  });
});

module.exports = {
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
};
