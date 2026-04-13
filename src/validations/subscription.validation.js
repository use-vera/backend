const { z } = require("zod");

const initializePremiumSubscriptionSchema = z.object({
  callbackUrl: z.string().trim().max(500).optional(),
});

const verifyPremiumSubscriptionSchema = z
  .object({
    reference: z.string().trim().min(1).max(120).optional(),
    paymentAttemptId: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, "Payment attempt ID must be valid")
      .optional(),
  })
  .refine(
    (value) => Boolean(value.reference || value.paymentAttemptId),
    {
      message: "Provide payment reference or paymentAttemptId",
      path: ["reference"],
    },
  );

module.exports = {
  initializePremiumSubscriptionSchema,
  verifyPremiumSubscriptionSchema,
};

