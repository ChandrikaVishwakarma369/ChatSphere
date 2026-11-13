const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/db.js");
const {
  invalidateConversationCache,
} = require("../service/messageCache.js");
const {
  createNotification,
  notificationInclude,
  updateCallNotification,
} = require("../service/notifications.js");

function chatSocket(io) {
  const userSockets = new Map();
  const pendingOffline = new Map();

  // WebRTC active call management
  const activeCalls = new Map();
  const userActiveCalls = new Map();
  const finishingCalls = new Set();

  const CALL_RECONNECT_GRACE_MS = 30000;

  function getOnlineUsers() {
    return [...userSockets.entries()]
      .filter(
        ([userId, sockets]) =>
          sockets.size > 0 || pendingOffline.has(userId),
      )
      .map(([userId]) => userId);
  }

  function getValidCall(callId) {
    if (typeof callId !== "string" || !callId.trim()) {
      return null;
    }

    return activeCalls.get(callId) || null;
  }

  async function emitCallHistoryUpdate(callId) {
    const savedCall = await prisma.call.findUnique({
      where: { callId },
      include: {
        caller: { select: { Fullname: true } },
        receiver: { select: { Fullname: true } },
      },
    });

    if (!savedCall) return;

    io.to(`user:${savedCall.callerId}`)
      .to(`user:${savedCall.receiverId}`)
      .emit("call_history_updated", savedCall);
  }

  async function finishCall(
    callId,
    endedBy,
    reason = "ENDED",
    source = "unknown",
  ) {
    const call = activeCalls.get(callId);

    if (!call) return false;

    // Prevent two events from finishing the same call simultaneously.
    if (finishingCalls.has(callId)) return false;

    finishingCalls.add(callId);

    try {
      try {
        const savedCall = await prisma.call.findUnique({
          where: { callId },
        });

        if (savedCall && !savedCall.endedAt) {
          const endedAt = new Date();
          let finalStatus = "FAILED";

          if (reason === "REJECTED") {
            finalStatus = "REJECTED";
          } else if (reason === "MISSED") {
            finalStatus = "MISSED";
          } else if (reason === "CANCELLED") {
            finalStatus = "CANCELLED";
          } else if (reason === "FAILED") {
            finalStatus = "FAILED";
          } else if (reason === "DISCONNECTED") {
            finalStatus =
              savedCall.status === "ACCEPTED" ? "FAILED" : "MISSED";
          } else if (reason === "ENDED") {
            finalStatus =
              savedCall.status === "ACCEPTED"
                ? "COMPLETED"
                : String(endedBy) === String(savedCall.callerId)
                  ? "CANCELLED"
                  : "REJECTED";
          }

          const duration = savedCall.answeredAt
            ? Math.max(
                0,
                Math.floor((endedAt - savedCall.answeredAt) / 1000),
              )
            : 0;

          const result = await prisma.call.updateMany({
            where: {
              callId,
              endedAt: null,
            },
            data: {
              status: finalStatus,
              endedAt,
              duration,
            },
          });

          if (result.count > 0) {
            const notificationType = {
              COMPLETED: "COMPLETED_CALL",
              MISSED: "MISSED_CALL",
              REJECTED: "CANCELLED_CALL",
              CANCELLED: "CANCELLED_CALL",
              FAILED: "FAILED_CALL",
            }[finalStatus];

            await updateCallNotification(
              io,
              callId,
              savedCall.receiverId,
              notificationType,
            );

            if (finalStatus === "REJECTED") {
              await createNotification(io, {
                userId: savedCall.callerId,
                senderId: savedCall.receiverId,
                callId,
                type: "REJECTED_CALL",
              });
            }
          }
        }

        await emitCallHistoryUpdate(callId);
      } catch (error) {
        console.error("Unable to persist call result:", {
          callId,
          reason,
          source,
          error,
        });
      }

      // Clear the ringing timer.
      if (call.ringTimer) {
        clearTimeout(call.ringTimer);
      }

      // Clear all reconnect timers.
      for (const timer of call.disconnectTimers.values()) {
        clearTimeout(timer);
      }

      // Remove the active call.
      activeCalls.delete(callId);

      if (userActiveCalls.get(call.callerId) === callId) {
        userActiveCalls.delete(call.callerId);
      }

      if (userActiveCalls.get(call.receiverId) === callId) {
        userActiveCalls.delete(call.receiverId);
      }

      const payload = {
        callId,
        endedBy,
        reason,
        source,
      };

      // Notify both participants.
      io.to(`user:${call.callerId}`).emit("call_ended", payload);
      io.to(`user:${call.receiverId}`).emit("call_ended", payload);

      return true;
    } finally {
      // Always release the finishing lock.
      finishingCalls.delete(callId);
    }
  }

  // JWT authentication
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

      const tabId = socket.handshake.auth?.tabId;

      if (typeof tabId !== "string" || !tabId.trim()) {
        return next(new Error("Invalid browser tab ID"));
      }

      socket.userId = String(user.id);
      socket.tabId = tabId;

      next();
    } catch (error) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const myRoom = `user:${socket.userId}`;

    socket.join(myRoom);

    // Restore an existing call only in its original browser tab.
    const activeCallId = userActiveCalls.get(socket.userId);

    if (activeCallId) {
      const call = activeCalls.get(activeCallId);

      if (call) {
        const isCaller = socket.userId === call.callerId;
        const ownerTabId = isCaller
          ? call.callerTabId
          : call.receiverTabId;

        if (socket.tabId === ownerTabId) {
          const previousSocketId = isCaller
            ? call.callerSocketId
            : call.receiverSocketId;

          const socketChanged = previousSocketId !== socket.id;

          if (isCaller) {
            call.callerSocketId = socket.id;
          } else {
            call.receiverSocketId = socket.id;
          }

          const reconnectTimer = call.disconnectTimers.get(socket.userId);

          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            call.disconnectTimers.delete(socket.userId);
          }

          const wasDisconnected = call.disconnectedUsers.has(
            socket.userId,
          );

          const needsPeerRecovery = wasDisconnected || socketChanged;

          call.disconnectedUsers.delete(socket.userId);

          if (socketChanged) {
            call.recoveryReady.clear();
            call.recoveryStarted = false;
          }

          socket.emit("call_restored", {
            callId: call.callId,
            callerId: call.callerId,
            receiverId: call.receiverId,
            video: call.video,
            status: call.status,
            role: isCaller ? "caller" : "callee",
          });

          if (needsPeerRecovery && call.status === "ACCEPTED") {
            call.recoveryStarted = false;

            const otherSocketId = isCaller
              ? call.receiverSocketId
              : call.callerSocketId;

            if (otherSocketId) {
              io.to(otherSocketId).emit("call_peer_reconnected", {
                callId: call.callId,
              });
            }
          }
        } else {
          socket.emit("call_active_in_another_tab", {
            callId: call.callId,
            video: call.video,
            role: isCaller ? "caller" : "callee",
          });
        }
      }
    }

    let sockets = userSockets.get(socket.userId);

    if (!sockets) {
      sockets = new Set();
      userSockets.set(socket.userId, sockets);
    }

    const wasOnline =
      sockets.size > 0 || pendingOffline.has(socket.userId);

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

    // SEND MESSAGE
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

        const message = await prisma.message.create({
          data: {
            senderId: Number(socket.userId),
            receiverId: receiver.id,
            text,
            status: "SENT",
          },
        });

        await createNotification(io, {
          userId: receiver.id,
          senderId: Number(socket.userId),
          messageId: message.id,
          type: "MESSAGE",
        });

        await invalidateConversationCache(
          Number(socket.userId),
          receiver.id,
        );

        const payload = {
          _id: String(message.id),
          sender: String(message.senderId),
          receiver: String(message.receiverId),
          text: message.text,
          status: message.status,
          createdAt: message.createdAt,
        };

        io.to(`user:${socket.userId}`)
          .to(`user:${String(receiver.id)}`)
          .emit("new_message", payload);

        reply({
          success: true,
          message: payload,
        });
      } catch (error) {
        console.error("Socket message error:", error);

        reply({
          success: false,
          message: "Unable to send message",
        });
      }
    });

    // MESSAGE DELIVERED
    socket.on("message_delivered", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      try {
        const messageId = Number(data?.messageId);
        const receiverId = Number(socket.userId);

        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
          return reply({
            success: false,
            message: "Invalid message ID",
          });
        }

        const message = await prisma.message.findFirst({
          where: {
            id: messageId,
            receiverId,
          },
        });

        if (!message) {
          return reply({
            success: false,
            message: "Message not found",
          });
        }

        const deliveredAt = new Date();

        const result = await prisma.message.updateMany({
          where: {
            id: messageId,
            receiverId,
            status: "SENT",
          },
          data: {
            status: "DELIVERED",
            deliveredAt,
          },
        });

        if (result.count > 0) {
          await invalidateConversationCache(
            message.senderId,
            message.receiverId,
          );

          io.to(`user:${message.senderId}`).emit(
            "message_status_updated",
            {
              messageId: String(messageId),
              status: "DELIVERED",
              deliveredAt,
            },
          );
        }

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

    // MESSAGE READ
    socket.on("message_read", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      try {
        const messageIds = data?.messageIds;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return reply({
            success: false,
            message: "Message IDs must be a non-empty array",
          });
        }

        const ids = [...new Set(messageIds.map(Number))];

        if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
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

        if (messages.length === 0) {
          return reply({
            success: true,
            message: "No unread messages",
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
              invalidateConversationCache(
                senderId,
                Number(socket.userId),
              ),
            ),
          );

          const messageIdsRead = messages.map(
            (message) => message.id,
          );

          try {
            const [unreadCount, updatedNotifications] =
              await Promise.all([
                prisma.notification.count({
                  where: {
                    userId: Number(socket.userId),
                    isRead: false,
                  },
                }),
                prisma.notification.findMany({
                  where: {
                    userId: Number(socket.userId),
                    messageId: { in: messageIdsRead },
                    isRead: true,
                  },
                  include: notificationInclude,
                }),
              ]);

            for (const notification of updatedNotifications) {
              io.to(`user:${socket.userId}`).emit(
                "notification_updated",
                {
                  notification,
                  unreadCount,
                },
              );
            }
          } catch (error) {
            console.error(
              "Unable to update message notifications:",
              error,
            );
          }
        }

        const senderGroup = new Map();

        for (const message of messages) {
          if (!senderGroup.has(message.senderId)) {
            senderGroup.set(message.senderId, []);
          }

          senderGroup.get(message.senderId).push(
            String(message.id),
          );
        }

        for (const [senderId, readIds] of senderGroup) {
          io.to(`user:${senderId}`).emit("message_status_updated", {
            messageIds: readIds,
            status: "READ",
          });
        }

        reply({
          success: true,
          message: "Messages seen successfully",
        });
      } catch (error) {
        console.error("Message read error:", error);

        reply({
          success: false,
          message: "Unable to mark messages as read",
        });
      }
    });

    // CALL INITIATION
    socket.on("call_user", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};
      let reservedCallId = null;

      try {
        const callerId = socket.userId;
        const receiverNumber = Number(data?.receiverId);
        const receiverId = String(receiverNumber);
        const video = data?.video !== false;

        if (
          !Number.isSafeInteger(receiverNumber) ||
          receiverNumber <= 0 ||
          receiverId === callerId
        ) {
          return reply({
            success: false,
            message: "Invalid receiver",
          });
        }

        if (
          userActiveCalls.has(callerId) ||
          userActiveCalls.has(receiverId)
        ) {
          socket.emit("call_busy", { receiverId });

          return reply({
            success: false,
            message: "User is busy",
          });
        }

        const receiverSockets = userSockets.get(receiverId);

        if (!receiverSockets || receiverSockets.size === 0) {
          return reply({
            success: false,
            message: "User is offline",
          });
        }

        const receiverTabSocket = [...receiverSockets]
          .reverse()
          .map((socketId) => io.sockets.sockets.get(socketId))
          .find(Boolean);

        if (!receiverTabSocket) {
          return reply({
            success: false,
            message: "Receiver tab is unavailable",
          });
        }

        const callId = crypto.randomUUID();
        reservedCallId = callId;

        const call = {
          callId,
          callerId,
          receiverId,
          callerTabId: socket.tabId,
          receiverTabId: receiverTabSocket.tabId,
          callerSocketId: socket.id,
          receiverSocketId: receiverTabSocket.id,
          video,
          status: "RINGING",
          disconnectedUsers: new Set(),
          disconnectTimers: new Map(),
          recoveryReady: new Set(),
          recoveryStarted: false,
          ringTimer: null,
        };

        activeCalls.set(callId, call);
        userActiveCalls.set(callerId, callId);
        userActiveCalls.set(receiverId, callId);

        await prisma.call.create({
          data: {
            callId,
            callerId: Number(callerId),
            receiverId: receiverNumber,
            video,
            status: "RINGING",
          },
        });

        const caller = await prisma.user.findUnique({
          where: { id: Number(callerId) },
          select: {
            id: true,
            Fullname: true,
          },
        });

        await createNotification(io, {
          userId: receiverNumber,
          senderId: Number(callerId),
          callId,
          type: video ? "VIDEO_CALL" : "AUDIO_CALL",
        });

        call.ringTimer = setTimeout(() => {
          const ringingCall = activeCalls.get(callId);

          if (ringingCall && ringingCall.status === "RINGING") {
            void finishCall(
              callId,
              receiverId,
              "MISSED",
              "ring timeout",
            );
          }
        }, 45000);

        io.to(receiverTabSocket.id).emit("incoming_call", {
          callId,
          callerId,
          callerName: caller?.Fullname || "User",
          video,
        });

        for (const socketId of userSockets.get(callerId) || []) {
          if (socketId !== socket.id) {
            io.to(socketId).emit("call_active_in_another_tab", {
              callId,
              video,
              role: "caller",
            });
          }
        }

        for (const socketId of userSockets.get(receiverId) || []) {
          if (socketId !== receiverTabSocket.id) {
            io.to(socketId).emit("call_active_in_another_tab", {
              callId,
              video,
              role: "callee",
            });
          }
        }

        await emitCallHistoryUpdate(callId);

        reply({
          success: true,
          callId,
        });
      } catch (error) {
        console.error("Call initiation error:", error);

        if (reservedCallId && activeCalls.has(reservedCallId)) {
          await finishCall(
            reservedCallId,
            socket.userId,
            "FAILED",
            "call initiation error",
          );
        }

        reply({
          success: false,
          message: "Unable to initiate call",
        });
      }
    });

    // CALL RECOVERY READY
    socket.on("call_recovery_ready", (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};
      const callId = data?.callId;
      const call = getValidCall(callId);

      if (!call || call.status !== "ACCEPTED") {
        return reply({
          success: false,
          message: "Call is no longer active.",
        });
      }

      const isCaller = call.callerId === socket.userId;
      const isReceiver = call.receiverId === socket.userId;

      if (!isCaller && !isReceiver) {
        return reply({
          success: false,
          message: "You are not a participant in this call.",
        });
      }

      const expectedTabId = isCaller
        ? call.callerTabId
        : call.receiverTabId;

      if (socket.tabId !== expectedTabId) {
        return reply({
          success: false,
          message: "Call recovery is allowed only in the original tab.",
        });
      }

      const expectedSocketId = isCaller
        ? call.callerSocketId
        : call.receiverSocketId;

      if (expectedSocketId !== socket.id) {
        return reply({
          success: false,
          message: "This socket is no longer assigned to the call.",
        });
      }

      call.recoveryReady.add(socket.userId);

      reply({
        success: true,
        message: "Call recovery preparation received.",
      });

      const bothReady =
        call.recoveryReady.has(call.callerId) &&
        call.recoveryReady.has(call.receiverId);

      if (!bothReady || call.recoveryStarted) {
        return;
      }

      call.recoveryStarted = true;

      io.to(call.callerSocketId).emit("call_recovery_start", {
        callId,
      });

      io.to(call.receiverSocketId).emit("call_recovery_start", {
        callId,
      });
    });

    // ACCEPT CALL
    socket.on("call_accepted", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (
        !call ||
        call.receiverId !== socket.userId ||
        call.receiverTabId !== socket.tabId ||
        call.status !== "RINGING"
      ) {
        return reply({
          success: false,
          message: "Invalid or expired call",
        });
      }

      await prisma.call.updateMany({
        where: {
          callId: data.callId,
          status: "RINGING",
          endedAt: null,
        },
        data: {
          status: "ACCEPTED",
          answeredAt: new Date(),
        },
      });

      call.status = "ACCEPTED";

      if (call.ringTimer) {
        clearTimeout(call.ringTimer);
        call.ringTimer = null;
      }

      await emitCallHistoryUpdate(call.callId);

      if (call.callerSocketId) {
        io.to(call.callerSocketId).emit("call_accepted", {
          callId: call.callId,
          receiverId: call.receiverId,
        });
      }

      reply({ success: true });
    });

    // REJECT CALL
    socket.on("call_rejected", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (
        !call ||
        call.receiverId !== socket.userId ||
        call.receiverTabId !== socket.tabId ||
        call.status !== "RINGING"
      ) {
        return reply({
          success: false,
          message: "Invalid call",
        });
      }

      await finishCall(
        call.callId,
        socket.userId,
        "REJECTED",
        "call_rejected event",
      );

      io.to(`user:${call.callerId}`).emit("call_rejected", {
        callId: call.callId,
      });

      reply({ success: true });
    });

    // SDP OFFER
    socket.on("webrtc_offer", (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (
        !call ||
        call.callerId !== socket.userId ||
        call.callerTabId !== socket.tabId ||
        call.callerSocketId !== socket.id ||
        call.status !== "ACCEPTED" ||
        !data?.offer
      ) {
        return reply({
          success: false,
          message: "Invalid WebRTC offer",
        });
      }

      if (!call.receiverSocketId) {
        return reply({
          success: false,
          message: "Receiver call tab is unavailable",
        });
      }

      io.to(call.receiverSocketId).emit("webrtc_offer", {
        callId: call.callId,
        offer: data.offer,
      });

      reply({ success: true });
    });

    // SDP ANSWER
    socket.on("webrtc_answer", (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (
        !call ||
        call.receiverId !== socket.userId ||
        call.receiverTabId !== socket.tabId ||
        call.receiverSocketId !== socket.id ||
        call.status !== "ACCEPTED" ||
        !data?.answer
      ) {
        return reply({
          success: false,
          message: "Invalid WebRTC answer",
        });
      }

      if (!call.callerSocketId) {
        return reply({
          success: false,
          message: "Caller call tab is unavailable",
        });
      }

      io.to(call.callerSocketId).emit("webrtc_answer", {
        callId: call.callId,
        answer: data.answer,
      });

      reply({ success: true });
    });

    // ICE CANDIDATE EXCHANGE
    socket.on("ice_candidate", (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (!call || call.status !== "ACCEPTED" || !data?.candidate) {
        return reply({
          success: false,
          message: "Invalid ICE candidate",
        });
      }

      const senderId = socket.userId;
      let receiverId;

      if (
        senderId === call.callerId &&
        socket.tabId === call.callerTabId &&
        socket.id === call.callerSocketId
      ) {
        receiverId = call.receiverId;
      } else if (
        senderId === call.receiverId &&
        socket.tabId === call.receiverTabId &&
        socket.id === call.receiverSocketId
      ) {
        receiverId = call.callerId;
      } else {
        return reply({
          success: false,
          message: "Unauthorized ICE candidate",
        });
      }

      const receiverSocketId =
        receiverId === call.callerId
          ? call.callerSocketId
          : call.receiverSocketId;

      if (!receiverSocketId) {
        return reply({
          success: false,
          message: "Peer call tab is unavailable",
        });
      }

      io.to(receiverSocketId).emit("ice_candidate", {
        callId: call.callId,
        candidate: data.candidate,
      });

      reply({ success: true });
    });

    // END CALL
    socket.on("end_call", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};

      const call = getValidCall(data?.callId);

      if (!call) {
        return reply({
          success: false,
          message: "Call not found or already ended.",
        });
      }

      const isCallerSocket =
        call.callerId === socket.userId &&
        call.callerTabId === socket.tabId &&
        call.callerSocketId === socket.id;

      const isReceiverSocket =
        call.receiverId === socket.userId &&
        call.receiverTabId === socket.tabId &&
        call.receiverSocketId === socket.id;

      if (!isCallerSocket && !isReceiverSocket) {
        return reply({
          success: false,
          message: "Unauthorized or outdated call socket.",
        });
      }

      const finished = await finishCall(
        call.callId,
        socket.userId,
        "ENDED",
        "end_call event",
      );

      if (!finished) {
        return reply({
          success: false,
          message: "Call could not be ended.",
        });
      }

      reply({ success: true });
    });

    // DISCONNECT
    socket.on("disconnect", () => {
      const activeSockets = userSockets.get(socket.userId);

      if (activeSockets) {
        activeSockets.delete(socket.id);
      }

      // Presence becomes OFFLINE only when the account has no connected tabs.
      if (!activeSockets || activeSockets.size === 0) {
        const presenceTimer = setTimeout(() => {
          const remainingSockets = userSockets.get(socket.userId);

          if (remainingSockets?.size > 0) return;

          userSockets.delete(socket.userId);
          pendingOffline.delete(socket.userId);

          io.emit("user_status_changed", {
            userId: socket.userId,
            status: "OFFLINE",
          });
        }, 1000);

        const previousTimer = pendingOffline.get(socket.userId);

        if (previousTimer) {
          clearTimeout(previousTimer);
        }

        pendingOffline.set(socket.userId, presenceTimer);
      }

      const activeCallId = userActiveCalls.get(socket.userId);

      if (!activeCallId) return;

      const call = activeCalls.get(activeCallId);

      if (!call) return;

      const isCaller = socket.userId === call.callerId;
      const ownerTabId = isCaller
        ? call.callerTabId
        : call.receiverTabId;

      if (socket.tabId !== ownerTabId) return;

      // Ignore an old socket's delayed disconnect event.
      const latestSocketId = isCaller
        ? call.callerSocketId
        : call.receiverSocketId;

      if (latestSocketId !== socket.id) return;

      call.disconnectedUsers.add(socket.userId);
      call.recoveryReady.delete(socket.userId);
      call.recoveryStarted = false;

      const otherSocketId = isCaller
        ? call.receiverSocketId
        : call.callerSocketId;

      if (otherSocketId) {
        io.to(otherSocketId).emit("call_peer_disconnected", {
          callId: call.callId,
          reconnectIn: CALL_RECONNECT_GRACE_MS,
        });
      }

      const oldTimer = call.disconnectTimers.get(socket.userId);

      if (oldTimer) {
        clearTimeout(oldTimer);
      }

      const reconnectTimer = setTimeout(() => {
        const currentCall = activeCalls.get(call.callId);

        if (!currentCall) return;

        if (!currentCall.disconnectedUsers.has(socket.userId)) {
          return;
        }

        const currentSockets = userSockets.get(socket.userId);

        const ownerTabIsConnected = [...(currentSockets || [])].some(
          (socketId) => {
            const connectedSocket = io.sockets.sockets.get(socketId);

            return (
              connectedSocket?.connected &&
              connectedSocket?.tabId === ownerTabId
            );
          },
        );

        if (ownerTabIsConnected) {
          currentCall.disconnectedUsers.delete(socket.userId);
          currentCall.disconnectTimers.delete(socket.userId);
          return;
        }

        void finishCall(
          currentCall.callId,
          socket.userId,
          "DISCONNECTED",
          "disconnect reconnect timeout",
        );
      }, CALL_RECONNECT_GRACE_MS);

      call.disconnectTimers.set(socket.userId, reconnectTimer);
    });
  });
}

module.exports = chatSocket;
