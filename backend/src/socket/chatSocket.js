const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db.js");
const { invalidateConversationCache } = require("../service/messageCache.js");
function chatSocket(io) {
  const userSockets = new Map();
  const pendingOffline = new Map();

  function getOnlineUsers() {
    return [...userSockets.entries()]
      .filter(
        ([userId, sockets]) =>
          sockets.size > 0 || pendingOffline.has(userId),
      )
      .map(([userId]) => userId);
  }

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(decoded.id || decoded.userId || decoded._id);

      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return next(new Error("Invalid token"));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.userId = String(user.id);
      next();
    } catch (error) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const myRoom = `user:${socket.userId}`;
    socket.join(myRoom);

    let sockets = userSockets.get(socket.userId);
    if (!sockets) {
      sockets = new Set();
      userSockets.set(socket.userId, sockets);
    }

    const wasOnline = sockets.size > 0 || pendingOffline.has(socket.userId);
    const offlineTimer = pendingOffline.get(socket.userId);
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      pendingOffline.delete(socket.userId);
    }

    sockets.add(socket.id);

    if (!wasOnline) {
      socket.broadcast.emit("user_status_changed", {
        userId: socket.userId,
        status: "ONLINE",
      });
    }

    socket.emit("online_users", getOnlineUsers());

    socket.on("get_online_users", () => {
      socket.emit("online_users", getOnlineUsers());
    });

    socket.on("send_message", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      try {
        const receiverId = Number(data?.receiverId);
        const text = data?.text?.trim();

        if (
          !Number.isSafeInteger(receiverId) ||
          receiverId <= 0 ||
          String(receiverId) === socket.userId
        ) {
          return reply({
            success: false,
            message: "Invalid receiver",
          });
        }

        if (!text || text.length > 5000) {
          return reply({
            success: false,
            message: "Message must be 1–5000 characters",
          });
        }

        const receiver = await prisma.user.findUnique({
          where: { id: receiverId },
          select: { id: true },
        });

        if (!receiver) {
          return reply({
            success: false,
            message: "Receiver not found",
          });
        }

        // 1. Save the message in PostgreSQL
        const message = await prisma.message.create({
          data: {
            senderId: Number(socket.userId),
            receiverId: receiver.id,
            text,
            status: "SENT",
          },
        });

        // 2. Invalidate the conversation's Redis cache
        await invalidateConversationCache(Number(socket.userId), receiver.id);

        // 3. Prepare the message for Socket.IO clients
        const payload = {
          _id: String(message.id),
          sender: String(message.senderId),
          receiver: String(message.receiverId),
          text: message.text,
          status: message.status,
          createdAt: message.createdAt,
        };

        // 4. Deliver to both users
        io.to(`user:${socket.userId}`)
          .to(`user:${String(receiver.id)}`)
          .emit("new_message", payload);

        // 5. Confirm successful sending
        reply({ success: true, message: payload });
      } catch (error) {
        console.error("Socket message error:", error);

        reply({
          success: false,
          message: "Unable to send message",
        });
      }
    });

    socket.on("message_delivered", async (data, callback) => {
      

      const reply = typeof callback === "function" ? callback : () => {};
      

      try {
        const messageId = Number(data?.messageId);
        const receiverId = Number(socket.userId);
 console.log("DELIVERY EVENT RECEIVED");
        console.log("Message ID:", messageId);
        console.log("Receiver ID:", receiverId);
        // 1. Validate message ID
        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
          return reply({
            success: false,
            message: "Invalid message ID",
          });
        }

        // 2. Find message for the logged-in receiver
        const message = await prisma.message.findFirst({
          where: {
            id: messageId,
            receiverId: receiverId,
          },
        });

        if (!message) {
          return reply({
            success: false,
            message: "Message not found",
          });
        }

        // 3. Update message status from SENT to DELIVERED
        const result = await prisma.message.updateMany({
          where: {
            id: messageId,
            receiverId: receiverId,
            status: "SENT",
          },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
          },
        });
        console.log("Update result:", result);

       
        // 4. Notify sender if status was updated
        if (result.count > 0) {
          await invalidateConversationCache(
            message.senderId,
            message.receiverId,
          );

          io.to(`user:${message.senderId}`).emit("message_status_updated", {
            messageId: String(messageId),
            status: "DELIVERED",
            deliveredAt: new Date(),
          });
        }

        // 5. Send acknowledgement to receiver
        return reply({
          success: true,
          message: "Message delivered successfully",
        });
      } catch (error) {
        console.error("Message delivery error:", error);

        return reply({
          success: false,
          message: "Unable to deliver the message",
        });
      }
    });

    socket.on("message_read", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};
      try {
        const messageIds = data?.messageIds;
        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return reply({
            success: false,
            message: "message ids not an array!",
          });
        }
        const ids = [...new Set(messageIds.map(Number))];

        if (
          ids.length === 0 ||
          !ids.every((id) => Number.isSafeInteger(id) && id > 0)
        ) {
          return reply({
            success: false,
            message: "Invalid message IDs",
          });
        }
        const messages = await prisma.message.findMany({
          where: {
            id: { in: ids },
            receiverId: Number(socket.userId),
            status: { not: "READ" },
          },
          select: {
            id: true,
            senderId: true,
            receiverId: true,
          },
        });
        if (messages.length === 0 || !messages) {
          return reply({
            success: false,
            message: "please write message!",
          });
        }
        const result = await prisma.message.updateMany({
          where: {
            id: { in: messages.map((message) => message.id) },
            receiverId: Number(socket.userId),
            status: { not: "READ" },
          },
          data: {
            status: "READ",
            readAt: new Date(),
          },
        });

        if (result.count > 0) {
          const senderIds = [
            ...new Set(messages.map((message) => message.senderId)),
          ];
          await Promise.all(
            senderIds.map((senderId) =>
              invalidateConversationCache(senderId, Number(socket.userId)),
            ),
          );
        }

        const senderGroup = new Map();
        for (const message of messages) {
          if (!senderGroup.has(message.senderId)) {
            senderGroup.set(message.senderId, []);
          }
          senderGroup.get(message.senderId).push(String(message.id));
        }
        for (const [senderId, readIds] of senderGroup) {
          io.to(`user:${senderId}`).emit("message_status_updated", {
            messageIds: readIds,
            status: "READ",
          });
        }
        reply({
          success: true,
          message: "messages seen successfully!",
        });
      } catch (error) {
        console.log(error.message);
        return reply({
          success: false,
          message: "messages could'nt seen!",
        });
      }
    });
    socket.on("disconnect", () => {
      console.log("Chat user disconnected:", socket.userId);

      const activeSockets = userSockets.get(socket.userId);
      if (!activeSockets) return;

      activeSockets.delete(socket.id);
      if (activeSockets.size > 0) return;

      const timer = setTimeout(() => {
        const remainingSockets = userSockets.get(socket.userId);
        if (remainingSockets?.size > 0) return;

        userSockets.delete(socket.userId);
        pendingOffline.delete(socket.userId);
        io.emit("user_status_changed", {
          userId: socket.userId,
          status: "OFFLINE",
        });
      }, 1000);

      pendingOffline.set(socket.userId, timer);
    });
  });
}

module.exports = chatSocket;
