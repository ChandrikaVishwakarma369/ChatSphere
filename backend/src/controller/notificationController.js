
const { prisma } = require("../config/db.js");
const {
  notificationInclude,
  getUnreadCount,
} = require("../service/notifications.js");

// Get all notifications and unread count for logged-in user.
const getNotifications = async (req, res) => {
  try {
    const userId = Number(req.user.id);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid user.",
      });
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        include: notificationInclude,
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
      getUnreadCount(userId),
    ]);

    return res.status(200).json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch notifications.",
    });
  }
};

// Mark only the selected notification as read.
const markNotificationAsRead = async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const notificationId = Number(req.params.id);

    if (
      !Number.isSafeInteger(notificationId) ||
      notificationId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
      });
    }

    const existingNotification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!existingNotification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    if (!existingNotification.isRead) {
      await prisma.notification.updateMany({
        where: {
          id: notificationId,
          userId,
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });
    }

    const [notification, unreadCount] = await Promise.all([
      prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId,
        },
        include: notificationInclude,
      }),
      getUnreadCount(userId),
    ]);

    // Synchronize the bell badge and notifications page across tabs.
    const io = req.app.get("io");

    if (io) {
      io.to(`user:${userId}`).emit("notification_updated", {
        notification,
        unreadCount,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      notification,
      unreadCount,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
};

// Mark all notifications as read.
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = Number(req.user.id);

    await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    const unreadCount = await getUnreadCount(userId);

    const io = req.app.get("io");

    if (io) {
      io.to(`user:${userId}`).emit("notification_updated", {
        unreadCount,
        allRead: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      unreadCount,
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
    });
  }
};

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
