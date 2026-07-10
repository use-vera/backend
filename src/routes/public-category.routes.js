const express = require("express");
const {
  listPublicCategoriesController,
} = require("../controllers/category.controller");

// Intentionally has no authMiddleware — lets the logged-out web events page
// render the category chip row. Always returns active categories only.
const router = express.Router();

router.get("/", listPublicCategoriesController);

module.exports = router;
