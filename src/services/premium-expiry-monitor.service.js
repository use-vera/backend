const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/user.model");
const transactionalEmails = require("./transactional-email.service");

/* Premium never renews by itself, so we say so a few days ahead. */
const NOTICE_DAYS_AHEAD = 3;
const BATCH_SIZE = 50;

let intervalHandle = null;
let tickRunning = false;

const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Emails everyone whose Premium ends within the notice window and hasn't
 * been told about this term yet. Each send is claimed first by stamping
 * `premiumExpiryNoticeFor` with the expiry, so two ticks (or two servers)
 * can't both send it, and renewing moves the expiry so the next term is
 * told again.
 */
const sendPremiumExpiryNotices = async ({ now = new Date() } = {}) => {
  const windowEnd = new Date(now.getTime() + NOTICE_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const candidates = await User.find({
    subscriptionTier: "premium",
    deletedAt: null,
    premiumExpiresAt: { $gt: now, $lte: windowEnd },
    $expr: { $ne: ["$premiumExpiryNoticeFor", "$premiumExpiresAt"] },
  })
    .select("_id premiumExpiresAt")
    .limit(BATCH_SIZE)
    .lean();

  let sent = 0;
  for (const candidate of candidates) {
    const claimed = await User.findOneAndUpdate(
      { _id: candidate._id, premiumExpiresAt: candidate.premiumExpiresAt, premiumExpiryNoticeFor: { $ne: candidate.premiumExpiresAt } },
      { $set: { premiumExpiryNoticeFor: candidate.premiumExpiresAt } },
      { new: true },
    )
      .select("_id")
      .lean();
    if (!claimed) continue;
    await transactionalEmails.premiumEndingSoon(candidate._id, { expiresAt: candidate.premiumExpiresAt });
    sent += 1;
  }
  return { sent };
};

const runPremiumExpiryMonitorTick = async () => {
  if (tickRunning || !isDbConnected()) {
    return;
  }

  tickRunning = true;

  try {
    await sendPremiumExpiryNotices();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[PremiumExpiryMonitor] Tick failed", error);
  } finally {
    tickRunning = false;
  }
};

const startPremiumExpiryMonitor = () => {
  if (intervalHandle || !env.premiumExpiryMonitorEnabled) {
    return;
  }

  intervalHandle = setInterval(() => {
    void runPremiumExpiryMonitorTick();
  }, env.premiumExpiryMonitorTickMs);

  void runPremiumExpiryMonitorTick();

  // eslint-disable-next-line no-console
  console.log(`[PremiumExpiryMonitor] Started (tick=${env.premiumExpiryMonitorTickMs}ms)`);
};

const stopPremiumExpiryMonitor = () => {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  tickRunning = false;
};

module.exports = {
  NOTICE_DAYS_AHEAD,
  sendPremiumExpiryNotices,
  startPremiumExpiryMonitor,
  stopPremiumExpiryMonitor,
  runPremiumExpiryMonitorTick,
};
