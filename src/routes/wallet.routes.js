const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const requireAdmin = require("../middlewares/require-admin.middleware");
const {
  validateBody,
  validateParams,
  validateQuery,
} = require("../middlewares/validate.middleware");
const {
  listWalletTransactionsQuerySchema,
  transactionIdParamsSchema,
  upsertPayoutAccountSchema,
  requestWithdrawalSchema,
  listWithdrawalsQuerySchema,
  applyChargebackSchema,
} = require("../validations/wallet.validation");
const {
  getWalletSummaryController,
  listWalletTransactionsController,
  getWalletTransactionController,
  runSettlementController,
  listBanksController,
  previewPayoutAccountController,
  upsertPayoutAccountController,
  getPayoutAccountController,
  deletePayoutAccountController,
  requestWithdrawalController,
  listWithdrawalsController,
  applyChargebackController,
} = require("../controllers/wallet.controller");

const router = express.Router();

router.use(authMiddleware);

router.get("/", getWalletSummaryController);
router.get(
  "/transactions",
  validateQuery(listWalletTransactionsQuerySchema),
  listWalletTransactionsController,
);
router.get(
  "/transactions/:transactionId",
  validateParams(transactionIdParamsSchema),
  getWalletTransactionController,
);
router.post("/settlement/run", requireAdmin, runSettlementController);

router.get("/banks", listBanksController);

router.post(
  "/payout-account/preview",
  validateBody(upsertPayoutAccountSchema),
  previewPayoutAccountController,
);
router.post(
  "/payout-account",
  validateBody(upsertPayoutAccountSchema),
  upsertPayoutAccountController,
);
router.get("/payout-account", getPayoutAccountController);
router.delete("/payout-account", deletePayoutAccountController);

router.post(
  "/withdrawals",
  validateBody(requestWithdrawalSchema),
  requestWithdrawalController,
);
router.get(
  "/withdrawals",
  validateQuery(listWithdrawalsQuerySchema),
  listWithdrawalsController,
);

router.post(
  "/admin/chargebacks",
  requireAdmin,
  validateBody(applyChargebackSchema),
  applyChargebackController,
);

module.exports = router;
