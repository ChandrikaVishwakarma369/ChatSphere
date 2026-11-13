const { prisma } = require("../config/db.js");

const notificationInclude = {
  sender: {
    select: {
      id: true,
      Fullname: true,
    },
  },
  message: {
    select: {
      id: true,
      text: true,
      fileName: true,
      fileType: true,
      fileUrl: true,
      createdAt: true,
    },
  },
  call: {
    select: {
      callId: true,
      video: true,
      status: true,
      startedAt: true,
      endedAt: true,
      duration: true,
    },
  },
};

async function getUnreadCount(userId) {
  return prisma.notification.count({
    where: {
      userId: Number(userId),
      isRead: false,
    },
  });
}

async function emitNotification(io, eventName, userId, notification) {
  if (!io || !notification) return;

  const unreadCount = await getUnreadCount(userId);

  io.to(`user:${userId}`).emit(eventName, {
    notification,
    unreadCount,
  });
}

async function createNotification(io, data) {
  try {
    const userId = Number(data.userId);
    const senderId = Number(data.senderId);

    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !Number.isSafeInteger(senderId) ||
      senderId <= 0 ||
      userId === senderId
    ) {
      throw new Error("Invalid notification user IDs");
    }

    let notification;

    // Avoid duplicate message notifications.
    if (data.messageId != null) {
      notification = await prisma.notification.findUnique({
        where: {
          messageId: Number(data.messageId),
        },
        include: notificationInclude,
      });
    }

    // Avoid duplicate call notifications for the same receiver.
    if (!notification && data.callId) {
      notification = await prisma.notification.findUnique({
        where: {
          userId_callId: {
            userId,
            callId: data.callId,
          },
        },
        include: notificationInclude,
      });
    }

    if (notification) return notification;

    notification = await prisma.notification.create({
      data: {
        userId,
        senderId,
        messageId:
          data.messageId != null ? Number(data.messageId) : null,
        callId: data.callId || null,
        type: data.type || "MESSAGE",
      },
      include: notificationInclude,
    });

    await emitNotification(
      io,
      "new_notification",
      userId,
      notification,
    );

    return notification;
  } catch (error) {
    // Another request may have created the same notification simultaneously.
    if (error.code === "P2002") {
      try {
        if (data.messageId != null) {
          return await prisma.notification.findUnique({
            where: {
              messageId: Number(data.messageId),
            },
            include: notificationInclude,
          });
        }

        if (data.callId) {
          return await prisma.notification.findUnique({
            where: {
              userId_callId: {
                userId: Number(data.userId),
                callId: data.callId,
              },
            },
            include: notificationInclude,
          });
        }
      } catch (lookupError) {
        console.error("Duplicate notification lookup error:", lookupError);
      }
    }

    console.error("Unable to create notification:", error);
    return null;
  }
}

async function updateCallNotification(io, callId, userId, type) {
  try {
    const existing = await prisma.notification.findUnique({
      where: {
        userId_callId: {
          userId: Number(userId),
          callId,
        },
      },
    });

    if (!existing) return null;

    const notification = await prisma.notification.update({
      where: {
        id: existing.id,
      },
      data: {
        type,
      },
      include: notificationInclude,
    });

    await emitNotification(
      io,
      "notification_updated",
      Number(userId),
      notification,
    );

    return notification;
  } catch (error) {
    console.error("Unable to update call notification:", error);
    return null;
  }
}

module.exports = {
  createNotification,
  notificationInclude,
  updateCallNotification,
  getUnreadCount,
};
