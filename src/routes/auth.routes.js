const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  validateBody,
  validateParams,
} = require("../middlewares/validate.middleware");
const { rateLimit } = require("../middlewares/rate-limit.middleware");
const {
  requestCodeSchema,
  verifyCodeSchema,
  completeSignUpSchema,
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  sessionIdParamsSchema,
} = require("../validations/auth.validation");
const {
  requestCode,
  verifyCode,
  completeSignUp,
  register,
  login,
  refresh,
  logout,
  getCurrentSession,
  createRealtimeToken,
  listSessionsController,
  revokeSessionController,
  revokeOtherSessionsController,
} = require("../controllers/auth.controller");

const router = express.Router();

const TEN_MINUTES_MS = 10 * 60 * 1000;

/* Per-IP backstops. The real limits are per inbox, in the service: these
   only stop one client hammering many inboxes, or guessing codes for one. */
const codeRequestLimit = rateLimit({
  windowMs: TEN_MINUTES_MS,
  max: 10,
  keyFn: (req) => `code-request:${req.ip}`,
});
const codeVerifyLimit = rateLimit({
  windowMs: TEN_MINUTES_MS,
  max: 30,
  keyFn: (req) => `code-verify:${req.ip}`,
});

router.post(
  "/code/request",
  codeRequestLimit,
  validateBody(requestCodeSchema),
  requestCode,
);
router.post(
  "/code/verify",
  codeVerifyLimit,
  validateBody(verifyCodeSchema),
  verifyCode,
);
router.post(
  "/code/complete-signup",
  codeVerifyLimit,
  validateBody(completeSignUpSchema),
  completeSignUp,
);

/* Password sign-in stays for the web app until it moves to codes too. */
router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.post("/refresh", validateBody(refreshSchema), refresh);
router.post("/logout", validateBody(logoutSchema), logout);
router.get("/me", authMiddleware, getCurrentSession);
router.post("/realtime-token", authMiddleware, createRealtimeToken);
router.get("/sessions", authMiddleware, listSessionsController);
router.post("/sessions/sign-out-others", authMiddleware, revokeOtherSessionsController);
router.delete(
  "/sessions/:sessionId",
  authMiddleware,
  validateParams(sessionIdParamsSchema),
  revokeSessionController,
);

module.exports = router;
