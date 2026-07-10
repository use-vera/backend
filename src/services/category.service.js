const slugify = require("slugify");
const ApiError = require("../utils/api-error");
const Category = require("../models/category.model");

const toSlug = (name) => slugify(name, { lower: true, strict: true, trim: true });

// Checked explicitly (not left to the DB's unique index alone) since a
// unique index on a freshly-created collection builds asynchronously in the
// background — relying on it to reject a duplicate insert is a race the
// very next request can lose. The unique index stays on the model as
// defense in depth for genuine concurrent double-submits; this check makes
// the common sequential case deterministic.
const assertSlugAvailable = async (name, excludeCategoryId) => {
  const slug = toSlug(name);
  const query = excludeCategoryId ? { slug, _id: { $ne: excludeCategoryId } } : { slug };

  if (await Category.exists(query)) {
    throw new ApiError(409, "A category with this name already exists");
  }
};

const createCategory = async ({ name, iconKey, description, sortOrder }) => {
  await assertSlugAvailable(name);

  try {
    return await Category.create({ name, iconKey, description, sortOrder });
  } catch (error) {
    if (Number(error.code) === 11000) {
      throw new ApiError(409, "A category with this name already exists");
    }

    throw error;
  }
};

const updateCategory = async (categoryId, payload) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  if (payload.name !== undefined) {
    await assertSlugAvailable(payload.name, categoryId);
    category.name = payload.name;
  }
  if (payload.iconKey !== undefined) category.iconKey = payload.iconKey;
  if (payload.description !== undefined) category.description = payload.description;
  if (payload.sortOrder !== undefined) category.sortOrder = payload.sortOrder;
  if (payload.isActive !== undefined) category.isActive = payload.isActive;

  try {
    await category.save();
  } catch (error) {
    if (Number(error.code) === 11000) {
      throw new ApiError(409, "A category with this name already exists");
    }

    throw error;
  }

  return category;
};

const listCategories = async ({ includeInactive = false } = {}) => {
  const query = includeInactive ? {} : { isActive: true };

  return Category.find(query).sort({ sortOrder: 1, name: 1 });
};

const getCategoryById = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  return category;
};

module.exports = {
  createCategory,
  updateCategory,
  listCategories,
  getCategoryById,
};
