const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
} = require("../middlewares/validate.middleware");
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} = require("../validations/auth.validation");
const {
  register,
  login,
  refresh,
  logout,
  getCurrentSession,
} = require("../controllers/auth.controller");

const router = express.Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.post("/refresh", validateBody(refreshSchema), refresh);
router.post("/logout", validateBody(logoutSchema), logout);
router.get("/me", authMiddleware, getCurrentSession);

module.exports = router;
