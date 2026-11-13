import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { getChatSocket } from "../socket";
import { NotificationCountContext } from "./notificationCount";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function NotificationProvider({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("token");
  const isAuthenticatedRoute =
    location.pathname !== "/login" && location.pathname !== "/register";
  const activeSocket =
    token && isAuthenticatedRoute ? getChatSocket(token) : null;
  const [unreadCount, setUnreadCount] = useState(0);
  const eventVersionRef = useRef(0);
  const seenNotificationIdsRef = useRef(new Set());

  const refreshUnreadCount = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const eventVersion = eventVersionRef.current;

    try {
      const response = await fetch(`${API_URL}/api/notifications`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to fetch notifications");
      }

      if (
        eventVersion === eventVersionRef.current &&
        Number.isSafeInteger(data.unreadCount)
      ) {
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error("Unread notification count error:", error);
    }
  }, []);

  useEffect(() => {
    if (!activeSocket) {
      return undefined;
    }

    const handleNewNotification = ({ notification, unreadCount: count } = {}) => {
      if (notification?.id != null) {
        const id = String(notification.id);
        if (seenNotificationIdsRef.current.has(id)) return;
        seenNotificationIdsRef.current.add(id);
      }

      eventVersionRef.current += 1;
      if (Number.isSafeInteger(count)) {
        setUnreadCount(count);
      } else if (!notification?.isRead) {
        setUnreadCount((previous) => previous + 1);
      }
    };

    const handleNotificationUpdated = ({ unreadCount: count } = {}) => {
      eventVersionRef.current += 1;
      if (Number.isSafeInteger(count)) {
        setUnreadCount(count);
      }
    };

    activeSocket.on("new_notification", handleNewNotification);
    activeSocket.on("notification_updated", handleNotificationUpdated);
    activeSocket.on("connect", refreshUnreadCount);
    queueMicrotask(refreshUnreadCount);

    return () => {
      activeSocket.off("new_notification", handleNewNotification);
      activeSocket.off("notification_updated", handleNotificationUpdated);
      activeSocket.off("connect", refreshUnreadCount);
    };
  }, [activeSocket, refreshUnreadCount]);

  const contextValue = useMemo(
    () => ({
      unreadCount,
      setUnreadCount,
      refreshUnreadCount,
      socket: activeSocket,
    }),
    [unreadCount, refreshUnreadCount, activeSocket],
  );

  return (
    <NotificationCountContext.Provider value={contextValue}>
      {children}
    </NotificationCountContext.Provider>
  );
}
