const express = require("express");
const { validateParams } = require("../middlewares/validate.middleware");
const {
  vendorSlugParamsSchema,
} = require("../validations/vendor.validation");
const {
  getPublicVendorMenuController,
} = require("../controllers/vendor.controller");

/**
 * A vendor's own page, readable by anyone.
 *
 * Intentionally has no authMiddleware: a vendor sharing their link with an
 * organizer, or an organizer sizing someone up before inviting them, should
 * not have to be signed in to look. The service only ever returns an active
 * vendor and the items that are actually on sale.
 *
 * It lives here rather than on the vendor router because that one is behind
 * auth, and a public GET /:slug there would also swallow /me.
 */
const router = express.Router();

router.get(
  "/:slug",
  validateParams(vendorSlugParamsSchema),
  getPublicVendorMenuController,
);

module.exports = router;
