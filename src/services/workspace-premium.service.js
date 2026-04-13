const ApiError = require("../utils/api-error");
const Membership = require("../models/membership.model");
const Workspace = require("../models/workspace.model");
const EventTicket = require("../models/event-ticket.model");
const AttendanceLog = require("../models/attendance-log.model");
const WorkspaceCampaign = require("../models/workspace-campaign.model");
const { createNotification } = require("./notification.service");
const { syncUserSubscriptionState } = require("./subscription.service");

const roleWeight = {
  member: 1,
  admin: 2,
  owner: 3,
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const normalizeWorkspaceRef = (workspaceRef) =>
  String(workspaceRef || "").trim().toLowerCase();

const buildPaginationMeta = ({ page, limit, totalItems }) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 ? page < totalPages : false,
    hasPrevPage: page > 1,
  };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveWorkspaceByRef = async (workspaceRef) => {
  const normalized = normalizeWorkspaceRef(workspaceRef);

  if (!normalized) {
    throw new ApiError(400, "Workspace reference is required");
  }

  if (objectIdRegex.test(normalized)) {
    const byId = await Workspace.findById(normalized);

    if (byId) {
      return byId;
    }
  }

  const bySlug = await Workspace.findOne({ slug: normalized });

  if (!bySlug) {
    throw new ApiError(404, "Workspace not found");
  }

  return bySlug;
};

const requireWorkspaceRole = async ({
  workspaceRef,
  actorUserId,
  minRole = "admin",
}) => {
  const workspace = await resolveWorkspaceByRef(workspaceRef);
  const membership = await Membership.findOne({
    workspaceId: workspace._id,
    userId: actorUserId,
    status: "active",
  });

  if (!membership) {
    throw new ApiError(403, "You are not an active member of this workspace");
  }

  if (roleWeight[membership.role] < roleWeight[minRole]) {
    throw new ApiError(403, "Insufficient permission for this action");
  }

  return {
    workspace,
    membership,
  };
};

const requirePremiumAccess = async (actorUserId) => {
  const { subscription } = await syncUserSubscriptionState({
    userId: actorUserId,
  });

  if (
    subscription.subscriptionTier !== "premium" ||
    subscription.subscriptionStatus !== "active"
  ) {
    throw new ApiError(403, "This feature is available on Vera Premium only");
  }

  return subscription;
};

const toDateRangeFilter = ({ from, to, field = "createdAt" }) => {
  if (!from || !to) {
    return {};
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new ApiError(400, "Invalid export date range");
  }

  if (fromDate > toDate) {
    throw new ApiError(400, "'from' cannot be later than 'to'");
  }

  return {
    [field]: {
      $gte: fromDate,
      $lte: toDate,
    },
  };
};

const quoteCsv = (value) => {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

const rowsToCsv = (rows) => {
  if (!rows.length) {
    return "";
  }

  const keys = Object.keys(rows[0]);
  const head = keys.map(quoteCsv).join(",");
  const body = rows
    .map((row) => keys.map((key) => quoteCsv(row[key])).join(","))
    .join("\n");

  return `${head}\n${body}`;
};

const normalizeBranding = (branding = {}) => ({
  displayName: String(branding.displayName || "").trim(),
  tagline: String(branding.tagline || "").trim(),
  logoUrl: String(branding.logoUrl || "").trim(),
  bannerUrl: String(branding.bannerUrl || "").trim(),
  primaryColor: String(branding.primaryColor || "#5BDFB3").trim() || "#5BDFB3",
  accentColor: String(branding.accentColor || "#7C5CFF").trim() || "#7C5CFF",
  websiteUrl: String(branding.websiteUrl || "").trim(),
  supportEmail: String(branding.supportEmail || "")
    .trim()
    .toLowerCase(),
  updatedByUserId: branding.updatedByUserId
    ? String(branding.updatedByUserId)
    : null,
  updatedAt: branding.updatedAt ? new Date(branding.updatedAt).toISOString() : null,
});

const getWorkspaceBranding = async ({ workspaceRef, actorUserId }) => {
  const { workspace, membership } = await requireWorkspaceRole({
    workspaceRef,
    actorUserId,
    minRole: "admin",
  });
  const subscription = await requirePremiumAccess(actorUserId);

  return {
    workspace: {
      _id: String(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
    },
    role: membership.role,
    subscription,
    branding: normalizeBranding(workspace.branding || {}),
  };
};

const updateWorkspaceBranding = async ({
  workspaceRef,
  actorUserId,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole({
    workspaceRef,
    actorUserId,
    minRole: "admin",
  });
  await requirePremiumAccess(actorUserId);

  const current = workspace.branding || {};
  const patch = {
    ...current,
    ...payload,
    supportEmail:
      payload.supportEmail !== undefined
        ? String(payload.supportEmail || "")
            .trim()
            .toLowerCase()
        : current.supportEmail,
    updatedByUserId: actorUserId,
    updatedAt: new Date(),
  };

  workspace.branding = patch;
  await workspace.save();

  return {
    workspace: {
      _id: String(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
    },
    branding: normalizeBranding(workspace.branding || {}),
  };
};

const listAudienceRecipients = async ({ workspaceId, audience }) => {
  const recipients = new Set();

  if (audience === "members" || audience === "all") {
    const members = await Membership.find({
      workspaceId,
      status: "active",
    })
      .select("userId")
      .lean();

    members.forEach((member) => {
      if (member?.userId) {
        recipients.add(String(member.userId));
      }
    });
  }

  if (audience === "attendees" || audience === "all") {
    const attendees = await EventTicket.find({
      workspaceId,
      status: { $in: ["paid", "used"] },
    })
      .select("buyerUserId")
      .lean();

    attendees.forEach((ticket) => {
      if (ticket?.buyerUserId) {
        recipients.add(String(ticket.buyerUserId));
      }
    });
  }

  return Array.from(recipients);
};

const listWorkspaceCampaigns = async ({
  workspaceRef,
  actorUserId,
  query = {},
}) => {
  const { workspace } = await requireWorkspaceRole({
    workspaceRef,
    actorUserId,
    minRole: "admin",
  });
  await requirePremiumAccess(actorUserId);

  const safePage = Math.max(1, Number(query.page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const filters = {
    workspaceId: workspace._id,
  };

  if (query.channel && query.channel !== "all") {
    filters.channel = query.channel;
  }

  if (query.audience && query.audience !== "all") {
    filters.audience = query.audience;
  }

  const search = String(query.search || "").trim();

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filters.$or = [{ subject: pattern }, { message: pattern }];
  }

  const [items, totalItems] = await Promise.all([
    WorkspaceCampaign.find(filters)
      .populate("createdByUserId", "fullName email")
      .sort({ sentAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    WorkspaceCampaign.countDocuments(filters),
  ]);

  return {
    items,
    ...buildPaginationMeta({
      page: safePage,
      limit: safeLimit,
      totalItems,
    }),
  };
};

const sendWorkspaceCampaign = async ({
  workspaceRef,
  actorUserId,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole({
    workspaceRef,
    actorUserId,
    minRole: "admin",
  });
  await requirePremiumAccess(actorUserId);

  const recipients = await listAudienceRecipients({
    workspaceId: workspace._id,
    audience: payload.audience,
  });
  const uniqueRecipients = Array.from(new Set(recipients));
  const subject =
    String(payload.subject || "").trim() || `Update from ${workspace.name}`;

  const campaign = await WorkspaceCampaign.create({
    workspaceId: workspace._id,
    createdByUserId: actorUserId,
    channel: payload.channel || "in_app",
    audience: payload.audience || "all",
    subject,
    message: payload.message,
    status: "sent",
    recipientsCount: uniqueRecipients.length,
    deliveredCount: 0,
    failedCount: 0,
    sentAt: new Date(),
    metadata: {
      deliveryMode:
        payload.channel === "in_app" ? "in_app_push" : "channel_fallback_in_app_push",
    },
  });

  if (!uniqueRecipients.length) {
    return {
      campaign,
      recipientsCount: 0,
      deliveredCount: 0,
      failedCount: 0,
    };
  }

  let delivered = 0;
  let failed = 0;

  const deliveries = await Promise.allSettled(
    uniqueRecipients.map((userId) =>
      createNotification({
        userId,
        type: "workspace_campaign",
        title: subject,
        message: payload.message,
        data: {
          workspaceId: String(workspace._id),
          campaignId: String(campaign._id),
          channel: payload.channel || "in_app",
          audience: payload.audience || "all",
        },
        push: true,
      }),
    ),
  );

  deliveries.forEach((result) => {
    if (result.status === "fulfilled") {
      delivered += 1;
    } else {
      failed += 1;
    }
  });

  campaign.deliveredCount = delivered;
  campaign.failedCount = failed;
  campaign.status =
    delivered === 0 && failed > 0
      ? "failed"
      : failed > 0
        ? "partial"
        : "sent";
  await campaign.save();

  return {
    campaign,
    recipientsCount: uniqueRecipients.length,
    deliveredCount: delivered,
    failedCount: failed,
  };
};

const buildTicketSalesRows = async ({ workspaceId, from, to }) => {
  const dateFilter = toDateRangeFilter({ from, to, field: "createdAt" });
  const query = {
    workspaceId,
    status: { $in: ["paid", "used"] },
    ...dateFilter,
  };

  const tickets = await EventTicket.find(query)
    .populate("eventId", "name startsAt feeMode")
    .populate("buyerUserId", "fullName email")
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  return tickets.map((ticket) => {
    const event =
      ticket.eventId && typeof ticket.eventId === "object" ? ticket.eventId : null;
    const buyer =
      ticket.buyerUserId && typeof ticket.buyerUserId === "object"
        ? ticket.buyerUserId
        : null;
    const metadata =
      ticket.paymentMetadata && typeof ticket.paymentMetadata === "object"
        ? ticket.paymentMetadata
        : {};

    return {
      ticketCode: ticket.ticketCode || "",
      eventName: event?.name || "",
      eventStartsAt: event?.startsAt
        ? new Date(event.startsAt).toISOString()
        : "",
      buyerName: buyer?.fullName || "",
      buyerEmail: buyer?.email || "",
      quantity: Number(ticket.quantity || 0),
      status: ticket.status || "",
      category: ticket.ticketCategoryName || "",
      feeMode:
        String(
          metadata?.pricingBreakdown?.feeMode || event?.feeMode || "absorbed_by_organizer",
        ).trim() || "absorbed_by_organizer",
      baseAmountNaira: Number(
        metadata?.pricingBreakdown?.basePriceNaira || ticket.totalPriceNaira || 0,
      ),
      veraFeeNaira: Number(metadata?.pricingBreakdown?.veraFeeNaira || 0),
      checkoutTotalNaira: Number(
        metadata?.pricingBreakdown?.totalCheckoutNaira || ticket.totalPriceNaira || 0,
      ),
      paidAt: ticket.paidAt ? new Date(ticket.paidAt).toISOString() : "",
      createdAt: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : "",
    };
  });
};

const buildAttendanceRows = async ({ workspaceId, from, to }) => {
  const dateFilter = toDateRangeFilter({ from, to, field: "timestamp" });
  const query = {
    workspaceId,
    ...dateFilter,
  };

  const logs = await AttendanceLog.find(query)
    .populate("userId", "fullName email")
    .sort({ timestamp: -1 })
    .limit(5000)
    .lean();

  return logs.map((log) => {
    const user = log.userId && typeof log.userId === "object" ? log.userId : null;

    return {
      timestamp: log.timestamp ? new Date(log.timestamp).toISOString() : "",
      type: log.type || "",
      userName: user?.fullName || "",
      userEmail: user?.email || "",
      location: log.location || "",
      geofence: log.geofence || "",
      latitude: Number(log.latitude || 0),
      longitude: Number(log.longitude || 0),
      accuracyMeters: Number(log.accuracyMeters || 0),
      method: log.method || "",
    };
  });
};

const buildCampaignRows = async ({ workspaceId, from, to }) => {
  const dateFilter = toDateRangeFilter({ from, to, field: "createdAt" });
  const query = {
    workspaceId,
    ...dateFilter,
  };

  const campaigns = await WorkspaceCampaign.find(query)
    .populate("createdByUserId", "fullName email")
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  return campaigns.map((campaign) => {
    const creator =
      campaign.createdByUserId && typeof campaign.createdByUserId === "object"
        ? campaign.createdByUserId
        : null;

    return {
      sentAt: campaign.sentAt ? new Date(campaign.sentAt).toISOString() : "",
      channel: campaign.channel || "",
      audience: campaign.audience || "",
      subject: campaign.subject || "",
      status: campaign.status || "",
      recipientsCount: Number(campaign.recipientsCount || 0),
      deliveredCount: Number(campaign.deliveredCount || 0),
      failedCount: Number(campaign.failedCount || 0),
      sentBy: creator?.fullName || "",
      sentByEmail: creator?.email || "",
    };
  });
};

const createWorkspaceDataExport = async ({
  workspaceRef,
  actorUserId,
  payload,
}) => {
  const { workspace } = await requireWorkspaceRole({
    workspaceRef,
    actorUserId,
    minRole: "admin",
  });
  await requirePremiumAccess(actorUserId);

  let rows = [];

  if (payload.kind === "ticket_sales") {
    rows = await buildTicketSalesRows({
      workspaceId: workspace._id,
      from: payload.from,
      to: payload.to,
    });
  } else if (payload.kind === "attendance_logs") {
    rows = await buildAttendanceRows({
      workspaceId: workspace._id,
      from: payload.from,
      to: payload.to,
    });
  } else {
    rows = await buildCampaignRows({
      workspaceId: workspace._id,
      from: payload.from,
      to: payload.to,
    });
  }

  const generatedAt = new Date();
  const fileStem = `${workspace.slug || "workspace"}-${payload.kind}-${generatedAt
    .toISOString()
    .slice(0, 10)}`;
  const isJson = payload.format === "json";
  const content = isJson
    ? JSON.stringify(rows, null, 2)
    : rowsToCsv(rows);

  return {
    workspace: {
      _id: String(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
    },
    kind: payload.kind,
    format: isJson ? "json" : "csv",
    fileName: `${fileStem}.${isJson ? "json" : "csv"}`,
    mimeType: isJson ? "application/json" : "text/csv",
    rowCount: rows.length,
    generatedAt: generatedAt.toISOString(),
    content,
  };
};

module.exports = {
  getWorkspaceBranding,
  updateWorkspaceBranding,
  listWorkspaceCampaigns,
  sendWorkspaceCampaign,
  createWorkspaceDataExport,
};
