const asyncHandler = require("../utils/async-handler");
const {
  createCategory,
  updateCategory,
  listCategories,
} = require("../services/category.service");

const listCategoriesController = asyncHandler(async (req, res) => {
  const categories = await listCategories({
    includeInactive: req.query.includeInactive,
  });

  res.status(200).json({
    success: true,
    message: "Categories fetched",
    data: categories,
  });
});

// Public counterpart — deliberately ignores any query params so a caller
// can never pass includeInactive=true to see deactivated categories.
const listPublicCategoriesController = asyncHandler(async (_req, res) => {
  const categories = await listCategories({ includeInactive: false });

  res.status(200).json({
    success: true,
    message: "Categories fetched",
    data: categories,
  });
});

const createCategoryController = asyncHandler(async (req, res) => {
  const category = await createCategory(req.body);

  res.status(201).json({
    success: true,
    message: "Category created",
    data: category,
  });
});

const updateCategoryController = asyncHandler(async (req, res) => {
  const category = await updateCategory(req.params.categoryId, req.body);

  res.status(200).json({
    success: true,
    message: "Category updated",
    data: category,
  });
});

const deleteCategoryController = asyncHandler(async (req, res) => {
  const category = await updateCategory(req.params.categoryId, {
    isActive: false,
  });

  res.status(200).json({
    success: true,
    message: "Category deactivated",
    data: category,
  });
});

module.exports = {
  listCategoriesController,
  listPublicCategoriesController,
  createCategoryController,
  updateCategoryController,
  deleteCategoryController,
};
