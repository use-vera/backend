const User = require("../models/user.model");
const { dispatchEmail } = require("./email.service");
const accountEmails = require("../emails/account.emails");
const moneyEmails = require("../emails/money.emails");

/**
 * Emails that follow something that already happened: a refund, a payout,
 * a sign-in. Every function here is send-and-forget. It looks the person up,
 * skips accounts that are deleted or have no real address, and never throws,
 * so a bad minute at the mail provider can't undo a refund or a payout.
 */

/* Deleted accounts get a placeholder address; never mail it. */
const isRealAddress = (email) => Boolean(email) && !/@deleted\.vera\.invalid$/i.test(email);

const lookUp = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).select("email fullName deletedAt").lean();
  return user && !user.deletedAt && isRealAddress(user.email) ? user : null;
};

/* Runs `build(user)` and sends what it returns. Logs and swallows anything that goes wrong. */
const emailUser = async (userId, build) => {
  try {
    const user = await lookUp(userId);
    if (!user) return null;
    const message = build(user);
    if (!message) return null;
    return await dispatchEmail({ to: user.email, ...message });
  } catch (error) {
    console.error("[transactional-email] could not build or send:", error?.message);
    return null;
  }
};

/* Sends to an address directly, for when the account no longer holds it (deletion). */
const emailAddress = async (email, message) => {
  if (!isRealAddress(email)) return null;
  try {
    return await dispatchEmail({ to: email, ...message });
  } catch (error) {
    console.error("[transactional-email] could not send:", error?.message);
    return null;
  }
};

const koboToNaira = (kobo) => Math.round(Number(kobo || 0) / 100);

module.exports = {
  welcome: (userId) => emailUser(userId, (user) => accountEmails.welcome({ fullName: user.fullName, email: user.email })),

  newSignIn: (userId, { deviceName, platform, signedInAt }) =>
    emailUser(userId, (user) => accountEmails.newSignIn({ deviceName, platform, signedInAt, email: user.email })),

  accountDeletionStarted: (email, { eraseWithinDays }) =>
    emailAddress(email, accountEmails.accountDeletionStarted({ email, eraseWithinDays })),

  accountDeletionCompleted: (email) => emailAddress(email, accountEmails.accountDeletionCompleted({ email })),

  premiumReceipt: (userId, { amountNaira, activeUntil, renewed, reference }) =>
    emailUser(userId, (user) => accountEmails.premiumReceipt({ amountNaira, activeUntil, renewed, reference, email: user.email })),

  premiumEndingSoon: (userId, { expiresAt }) =>
    emailUser(userId, (user) => accountEmails.premiumEndingSoon({ expiresAt, email: user.email })),

  eventCancelled: (userId, details) => emailUser(userId, (user) => moneyEmails.eventCancelled({ ...details, email: user.email })),

  refundIssued: (userId, details) => emailUser(userId, (user) => moneyEmails.refundIssued({ ...details, email: user.email })),

  withdrawalSent: (userId, { amountKobo, bankName, last4, reference, sentAt }) =>
    emailUser(userId, (user) =>
      moneyEmails.withdrawalSent({ amountNaira: koboToNaira(amountKobo), bankName, last4, reference, sentAt, email: user.email }),
    ),

  withdrawalFailed: (userId, { amountKobo }) =>
    emailUser(userId, (user) => moneyEmails.withdrawalFailed({ amountNaira: koboToNaira(amountKobo), email: user.email })),

  resaleSold: (userId, details) => emailUser(userId, (user) => moneyEmails.resaleSold({ ...details, email: user.email })),

  resalePayoutPaid: (userId, { amountKobo, bankName, last4 }) =>
    emailUser(userId, (user) => moneyEmails.resalePayoutPaid({ amountNaira: koboToNaira(amountKobo), bankName, last4, email: user.email })),

  resalePayoutNeedsAccount: (userId, { amountKobo }) =>
    emailUser(userId, (user) => moneyEmails.resalePayoutNeedsAccount({ amountNaira: koboToNaira(amountKobo), email: user.email })),
};
