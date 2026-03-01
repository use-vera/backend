const dotenv = require("dotenv");
dotenv.config();

const PAYSTACK = {
  SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || "",
  BASE_URL: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL || "",
};

module.exports = PAYSTACK;
