const { z } = require("zod");

const emailSchema = z.string().email().transform((value) => value.toLowerCase().trim());

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: z.string().min(8).max(128),
  workspaceName: z.string().trim().min(2).max(120).optional(),
});

/* Optional, from the app: what to call this device in "where you're signed in". */
const deviceSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    platform: z.enum(["ios", "android", "web"]).optional(),
    appVersion: z.string().trim().max(32).optional(),
  })
  .optional();

const sessionIdParamsSchema = z.object({
  sessionId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid session id"),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  device: deviceSchema,
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20).max(4000),
  device: deviceSchema,
});

const logoutSchema = z.object({
  refreshToken: z.string().trim().min(20).max(4000).optional(),
});

/* Trimmed before it's checked: a pasted address often carries a space. */
const codeEmailSchema = z.string().trim().toLowerCase().email().max(254);

const requestCodeSchema = z.object({
  email: codeEmailSchema,
});

const verifyCodeSchema = z.object({
  email: codeEmailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  device: deviceSchema,
});

const completeSignUpSchema = z.object({
  signupToken: z.string().trim().min(20).max(2000),
  fullName: z.string().trim().min(2).max(120),
  phoneNumber: z.string().trim().max(32).optional(),
  /* Must be literally true: an account can't exist without agreeing. */
  acceptTerms: z.literal(true, {
    message: "You need to agree to the Terms and Privacy Policy",
  }),
  marketingOptIn: z.boolean().optional().default(false),
  device: deviceSchema,
});

module.exports = {
  requestCodeSchema,
  verifyCodeSchema,
  completeSignUpSchema,
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  sessionIdParamsSchema,
};
