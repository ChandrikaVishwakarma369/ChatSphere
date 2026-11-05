import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket;
let socketToken;

export function getChatSocket(token) {
  if (socket && socketToken !== token) {
    disconnectChatSocket(socket);
  }

  if (!socket) {
    socketToken = token;
    socket = io(API, {
      autoConnect: false,
      auth: { token },
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
