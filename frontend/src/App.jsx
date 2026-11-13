import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Notification from "./components/Notification";
import { CallProvider } from "./context/CallContext";
import IncomingCall from "./components/IncomingCall";
import CallScreen from "./components/CallScreen";
import { getChatSocket } from "./socket";
import { useEffect } from "react";
import { NotificationProvider } from "./context/NotificationContext";
const App = () => {
  const token = localStorage.getItem("token");

const socket = token ? getChatSocket(token) : null;

useEffect(() => {
  if (!socket) return;

  if (!socket.connected) {
    socket.connect();
  }

  return () => {
  };
}, [socket]);
  return (
    <BrowserRouter>
      <CallProvider>
        <NotificationProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<Home />} />
            <Route path="/chat/:userId" element={<Chat />} />
            <Route path="/notifications" element={<Notification />} />
          </Routes>

          <IncomingCall />
          <CallScreen />
        </NotificationProvider>
      </CallProvider>
    </BrowserRouter>
  );
};

export default App;
