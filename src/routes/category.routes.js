const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const requireAdmin = require("../middlewares/require-admin.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  createCategorySchema,
  updateCategorySchema,
  categoryParamsSchema,
  listCategoriesQuerySchema,
} = require("../validations/category.validation");
const {
  listCategoriesController,
  createCategoryController,
  updateCategoryController,
  deleteCategoryController,
} = require("../controllers/category.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/", validateQuery(listCategoriesQuerySchema), listCategoriesController);
router.post("/", requireAdmin, validateBody(createCategorySchema), createCategoryController);
router.patch(
  "/:categoryId",
  requireAdmin,
  validateParams(categoryParamsSchema),
  validateBody(updateCategorySchema),
  updateCategoryController,
);
router.delete(
  "/:categoryId",
  requireAdmin,
  validateParams(categoryParamsSchema),
  deleteCategoryController,
);

module.exports = router;
