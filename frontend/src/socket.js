
import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_URL || `${import.meta.env.VITE_API_URL || "http://localhost:5000"}`";

let socket;
let socketToken;

export function getChatTabId() {
  let tabId = sessionStorage.getItem("chatTabId");

  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem("chatTabId", tabId);
  }

  return tabId; 
}

export function getChatSocket(token) {
  if (socket && socketToken !== token) {
    disconnectChatSocket(socket);
  }

  if (!socket) {
    socketToken = token;

    const tabId = getChatTabId();

    socket = io(API, {
      autoConnect: false,
      auth: {
        token,
        tabId,
      },
      reconnection: true,
    });
  }

  return socket;
}

export function disconnectChatSocket(targetSocket) {
  if (!socket || (targetSocket && socket !== targetSocket)) return;

  socket.disconnect();
  socket = null;
  socketToken = null;
}
