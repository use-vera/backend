const { z } = require("zod");

const emailSchema = z.string().email().transform((value) => value.toLowerCase().trim());

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: z.string().min(8).max(128),
  workspaceName: z.string().trim().min(2).max(120).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20).max(4000),
});

const logoutSchema = z.object({
  refreshToken: z.string().trim().min(20).max(4000).optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
};
