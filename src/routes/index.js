const express = require("express");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const workspaceRoutes = require("./workspace.routes");
const inviteRoutes = require("./invite.routes");
const eventRoutes = require("./event.routes");
const notificationRoutes = require("./notification.routes");
const chatRoutes = require("./chat.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/workspaces", workspaceRoutes);
router.use("/invites", inviteRoutes);
router.use("/events", eventRoutes);
router.use("/notifications", notificationRoutes);
router.use("/chats", chatRoutes);

module.exports = router;
