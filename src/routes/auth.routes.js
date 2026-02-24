const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
} = require("../middlewares/validate.middleware");
const {
  registerSchema,
  loginSchema,
} = require("../validations/auth.validation");
const {
  register,
  login,
  getCurrentSession,
} = require("../controllers/auth.controller");

const router = express.Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.get("/me", authMiddleware, getCurrentSession);

module.exports = router;
