
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware.js");

const {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require("../controller/notificationController.js");

router.get("/", authMiddleware, getNotifications);

router.patch("/:id/read", authMiddleware, markNotificationAsRead);

router.patch("/read-all", authMiddleware, markAllNotificationsAsRead);

module.exports = router;
