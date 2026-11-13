import { useContext } from "react";
import { NotificationCountContext } from "./notificationCount";

export function useNotificationCount() {
  const context = useContext(NotificationCountContext);

  if (!context) {
    throw new Error(
      "useNotificationCount must be used within a NotificationProvider",
    );
  }

  return context;
}
