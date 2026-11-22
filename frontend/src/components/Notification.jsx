
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Phone,
  PhoneMissed,
  PhoneOff,
  Video,
} from "lucide-react";
import { useNotificationCount } from "../context/useNotificationCount";

const API_URL = `${import.meta.env.VITE_API_URL || `${import.meta.env.VITE_API_URL || "http://localhost:5000"}`"}/api`;

const Notification = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readingIds, setReadingIds] = useState([]);

  const navigate = useNavigate();

  const {
    unreadCount,
    setUnreadCount,
    socket,
    refreshUnreadCount,
  } = useNotificationCount();

  // Fetch notifications from database
  const fetchNotifications = useCallback(async () => {
    try {
      setError("");

      const token = localStorage.getItem("token");

      if (!token) {
        throw new Error("Please login first.");
      }

      const response = await fetch(`${API_URL}/notifications`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to fetch notifications.");
      }

      setNotifications((previous) => {
        const previousMap = new Map(
          previous.map((notification) => [
            String(notification.id),
            notification,
          ]),
        );

        const merged = (data.notifications || []).map((notification) => {
          const existing = previousMap.get(String(notification.id));

          return {
            ...existing,
            ...notification,

            // A read notification must never become unread again.
            isRead: Boolean(existing?.isRead || notification.isRead),
          };
        });

        return merged.sort(
          (first, second) =>
            new Date(second.createdAt) - new Date(first.createdAt),
        );
      });

      if (Number.isSafeInteger(data.unreadCount)) {
        setUnreadCount(data.unreadCount);
      }
    } catch (err) {
      console.error("Notifications error:", err);
      setError(err.message || "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [setUnreadCount]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Listen for new and updated notifications
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = ({ notification } = {}) => {
      if (!notification) return;

      setNotifications((previous) => {
        const exists = previous.some(
          (item) => String(item.id) === String(notification.id),
        );

        if (exists) {
          return previous.map((item) =>
            String(item.id) === String(notification.id)
              ? { ...item, ...notification }
              : item,
          );
        }

        return [notification, ...previous];
      });

      // NotificationContext handles the unread count.
    };

    const handleNotificationUpdated = ({ notification } = {}) => {
      if (!notification) return;

      setNotifications((previous) =>
        previous.map((item) =>
          String(item.id) === String(notification.id)
            ? { ...item, ...notification }
            : item,
        ),
      );
    };

    socket.on("new_notification", handleNewNotification);
    socket.on("notification_updated", handleNotificationUpdated);

    return () => {
      socket.off("new_notification", handleNewNotification);
      socket.off("notification_updated", handleNotificationUpdated);
    };
  }, [socket]);

  // Open sender's chat
  const openChat = (notification) => {
    const senderId = notification.sender?.id;

    if (!senderId) {
      console.error("Sender ID is missing from notification.");
      return;
    }

    navigate(`/chat/${senderId}`);
  };

  // Mark only the clicked notification as read
  const handleNotificationClick = async (notification) => {
    if (readingIds.includes(notification.id)) return;

    if (!notification.isRead) {
      try {
        setReadingIds((previous) => [...previous, notification.id]);

        const token = localStorage.getItem("token");

        const response = await fetch(
          `${API_URL}/notifications/${notification.id}/read`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || "Unable to update notification.",
          );
        }

        setNotifications((previous) =>
          previous.map((item) =>
            String(item.id) === String(notification.id)
              ? { ...item, ...data.notification, isRead: true }
              : item,
          ),
        );

        if (Number.isSafeInteger(data.unreadCount)) {
          setUnreadCount(data.unreadCount);
        } else {
          await refreshUnreadCount();
        }
      } catch (err) {
        console.error("Mark notification read error:", err);
        setError(err.message || "Unable to update notification.");
        return;
      } finally {
        setReadingIds((previous) =>
          previous.filter((id) => id !== notification.id),
        );
      }
    }

    // Message notifications open the sender's chat.
    // Call notifications retain their existing behavior.
    if (!notification.type || notification.type === "MESSAGE") {
      openChat(notification);
    }
  };

  // Call notification descriptions
  const getCallSummary = (type, callMode) => {
    const mode = callMode.toLowerCase();

    return (
      {
        AUDIO_CALL: "Incoming audio call",
        VIDEO_CALL: "Incoming video call",
        MISSED_CALL: `Missed ${mode} call`,
        REJECTED_CALL: `${callMode} call was rejected`,
        COMPLETED_CALL: `${callMode} call completed`,
        CANCELLED_CALL: `${callMode} call was cancelled`,
        FAILED_CALL: `${callMode} call could not be completed`,
      }[type] || `${callMode} call`
    );
  };

  // Format notification time
  const formatTime = (date) => {
    if (!date) return "";

    return new Date(date).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-lime-50 via-white to-emerald-50 px-4 py-10 sm:px-6">
        <div className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-lime-100 bg-white px-6 py-5 text-sm font-medium text-gray-600 shadow-sm">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-lime-200 border-t-lime-600" />
            Loading notifications...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-lime-50 via-white to-emerald-50 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-lime-100 bg-white/90 p-5 shadow-sm sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-lime-700">
              Stay connected
            </p>

            <h1 className="text-2xl font-bold tracking-tight text-gray-800 sm:text-3xl">
              Notifications
            </h1>

            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              Your recent messages and updates
            </p>
          </div>

          <div className="flex w-fit items-center gap-2 rounded-full border border-lime-200 bg-lime-50 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-lime-600" />

            <span className="text-sm font-semibold text-lime-800">
              {unreadCount} unread
            </span>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>

            <button
              onClick={fetchNotifications}
              className="w-fit rounded-lg border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 transition hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {notifications.length === 0 ? (
          <div className="rounded-2xl border border-lime-100 bg-white px-6 py-14 text-center shadow-sm sm:px-10 sm:py-16">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-100 to-emerald-100 text-3xl">
              🔔
            </div>

            <h2 className="text-lg font-bold text-gray-800 sm:text-xl">
              No notifications yet
            </h2>

            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-500">
              When someone sends you a message or calls you, it will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-lime-100 bg-white shadow-sm">

            {notifications.map((notification) => {
              const sender = notification.sender;
              const message = notification.message;
              const type = notification.type || "MESSAGE";
              const isMessage = type === "MESSAGE";
              const isRead = notification.isRead === true;

              const callMode =
                notification.call?.video || type === "VIDEO_CALL"
                  ? "Video"
                  : "Audio";

              const Icon = isMessage
                ? MessageSquare
                : type === "MISSED_CALL"
                  ? PhoneMissed
                  : [
                      "REJECTED_CALL",
                      "CANCELLED_CALL",
                      "FAILED_CALL",
                    ].includes(type)
                    ? PhoneOff
                    : callMode === "Video"
                      ? Video
                      : Phone;

              const preview = isMessage
                ? message?.text && message?.fileName
                  ? `${message.text} · 📎 ${message.fileName}`
                  : message?.text ||
                    (message?.fileName
                      ? `📎 ${message.fileName}`
                      : "Sent you a message")
                : getCallSummary(type, callMode);

              const isUpdating = readingIds.includes(notification.id);

              return (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  disabled={isUpdating}
                  aria-label={`${sender?.Fullname || "Unknown User"}: ${preview}`}
                  className={`flex w-full items-start gap-3 border-b border-gray-100 p-4 text-left transition last:border-b-0 sm:items-center sm:gap-4 sm:px-6 sm:py-5 ${
                    !isRead
                      ? "bg-lime-50/70 hover:bg-lime-50"
                      : "bg-white hover:bg-gray-50"
                  } disabled:cursor-wait`}
                >
                  {/* Sender avatar */}
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-200 to-emerald-200 text-lg font-extrabold text-lime-800">
                    {sender?.Fullname?.charAt(0)?.toUpperCase() || "U"}
                  </div>

                  {/* Notification details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <h3 className="truncate text-sm font-bold text-gray-800 sm:text-base">
                        {sender?.Fullname || "Unknown User"}
                      </h3>

                      <span className="shrink-0 text-xs text-gray-400">
                        {formatTime(
                          notification.call?.startedAt ||
                            notification.createdAt,
                        )}
                      </span>
                    </div>

                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-lime-800 ring-1 ring-lime-200">
                        <Icon className="mr-1 inline-block" size={12} />
                        {isMessage
                          ? "Message"
                          : getCallSummary(type, callMode)}
                      </span>

                      <p className="min-w-0 flex-1 truncate text-sm leading-5 text-gray-600">
                        {preview}
                      </p>
                    </div>

                    {/* Call duration */}
                    {!isMessage && notification.call?.duration > 0 && (
                      <p className="mt-1 text-xs text-gray-400">
                        Duration:{" "}
                        {Math.floor(notification.call.duration / 60)}m{" "}
                        {notification.call.duration % 60}s
                      </p>
                    )}

                    {/* Explicit read/unread status */}
                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          isRead
                            ? "bg-gray-100 text-gray-500"
                            : "bg-lime-100 text-lime-800"
                        }`}
                      >
                        {isRead ? "Read" : "Unread"}
                      </span>
                    </div>
                  </div>

                  {/* Unread indicator */}
                  {!isRead && (
                    <span
                      aria-label="Unread notification"
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-lime-600 ring-4 ring-lime-100 sm:mt-0"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Notification;
