const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateBody } = require("../middlewares/validate.middleware");
const { uploadAssetSchema } = require("../validations/file.validation");
const { uploadAssetController } = require("../controllers/file.controller");

const router = express.Router();

router.use(authMiddleware);

router.post("/upload", validateBody(uploadAssetSchema), uploadAssetController);

module.exports = router;
