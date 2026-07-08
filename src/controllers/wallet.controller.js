const asyncHandler = require("../utils/async-handler");
const {
  getWalletSummary,
  listWalletTransactions,
} = require("../services/wallet.service");
const {
  triggerManualSettlement,
} = require("../services/wallet-settlement.service");
const {
  listNigerianBanks,
  previewPayoutAccount,
  upsertPayoutAccount,
  getPayoutAccount,
  deletePayoutAccount,
} = require("../services/payout-account.service");
const {
  requestWithdrawal,
  listWithdrawals,
} = require("../services/withdrawal.service");
const { applyChargeback } = require("../services/chargeback.service");

const getWalletSummaryController = asyncHandler(async (req, res) => {
  const result = await getWalletSummary(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Wallet fetched",
    data: result,
  });
});

const listWalletTransactionsController = asyncHandler(async (req, res) => {
  const result = await listWalletTransactions({
    organizerUserId: req.auth.userId,
    type: req.query.type,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Wallet transactions fetched",
    data: result,
  });
});

const runSettlementController = asyncHandler(async (req, res) => {
  const result = await triggerManualSettlement({ actorUserId: req.auth.userId });

  res.status(200).json({
    success: true,
    message: "Settlement tick complete",
    data: result,
  });
});

const listBanksController = asyncHandler(async (req, res) => {
  const result = await listNigerianBanks();

  res.status(200).json({
    success: true,
    message: "Banks fetched",
    data: result,
  });
});

const previewPayoutAccountController = asyncHandler(async (req, res) => {
  const result = await previewPayoutAccount({
    bankCode: req.body.bankCode,
    accountNumber: req.body.accountNumber,
  });

  res.status(200).json({
    success: true,
    message: "Payout account resolved",
    data: result,
  });
});

const upsertPayoutAccountController = asyncHandler(async (req, res) => {
  const result = await upsertPayoutAccount({
    organizerUserId: req.auth.userId,
    bankCode: req.body.bankCode,
    accountNumber: req.body.accountNumber,
  });

  res.status(200).json({
    success: true,
    message: "Payout account saved",
    data: result,
  });
});

const getPayoutAccountController = asyncHandler(async (req, res) => {
  const result = await getPayoutAccount(req.auth.userId);

  res.status(200).json({
    success: true,
    message: "Payout account fetched",
    data: result,
  });
});

const deletePayoutAccountController = asyncHandler(async (req, res) => {
  const result = await deletePayoutAccount({ organizerUserId: req.auth.userId });

  res.status(200).json({
    success: true,
    message: result.deleted ? "Payout account removed" : "No payout account to remove",
    data: result,
  });
});

const requestWithdrawalController = asyncHandler(async (req, res) => {
  const result = await requestWithdrawal({
    organizerUserId: req.auth.userId,
    amountKobo: req.body.amountKobo,
  });

  res.status(201).json({
    success: true,
    message: "Withdrawal requested",
    data: result,
  });
});

const listWithdrawalsController = asyncHandler(async (req, res) => {
  const result = await listWithdrawals({
    organizerUserId: req.auth.userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.status(200).json({
    success: true,
    message: "Withdrawals fetched",
    data: result,
  });
});

const applyChargebackController = asyncHandler(async (req, res) => {
  const result = await applyChargeback({
    ticketId: req.body.ticketId,
    actorUserId: req.auth.userId,
    amountKobo: req.body.amountKobo,
    reason: req.body.reason,
  });

  res.status(201).json({
    success: true,
    message: "Chargeback applied",
    data: result,
  });
});

module.exports = {
  getWalletSummaryController,
  listWalletTransactionsController,
  runSettlementController,
  listBanksController,
  previewPayoutAccountController,
  upsertPayoutAccountController,
  getPayoutAccountController,
  deletePayoutAccountController,
  requestWithdrawalController,
  listWithdrawalsController,
  applyChargebackController,
};
