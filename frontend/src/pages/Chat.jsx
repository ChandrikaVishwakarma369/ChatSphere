import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, X, FileText } from "lucide-react";
import { disconnectChatSocket, getChatSocket } from "../socket";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

function getId(user) {
  if (!user) return null;
  return user.id ?? user._id ?? user.userId ?? null;
}

function getSenderId(message) {
  return (
    message.senderId ??
    message.sender?.id ??
    message.sender?._id ??
    message.sender
  );
}

function getReceiverId(message) {
  return (
    message.receiverId ??
    message.receiver?.id ??
    message.receiver?._id ??
    message.receiver
  );
}

function getMessageId(message) {
  return message.id ?? message._id;
}

function getValidMessageId(message) {
  const id = Number(getMessageId(message));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getStatusRank(status) {
  return { SENT: 0, DELIVERED: 1, READ: 2 }[status] ?? -1;
}

function mergeMessages(existing, incoming, statusUpdates) {
  const merged = [...existing];

  for (const incomingMessage of incoming) {
    const messageId = getMessageId(incomingMessage);

    const existingIndex = merged.findIndex(
      (message) =>
        messageId != null &&
        String(getMessageId(message)) === String(messageId),
    );

    const previous = existingIndex === -1 ? null : merged[existingIndex];

    let message = { ...previous, ...incomingMessage };

    const statusUpdate =
      messageId == null ? null : statusUpdates[String(messageId)];

    if (
      statusUpdate &&
      getStatusRank(statusUpdate.status) > getStatusRank(message.status)
    ) {
      message = { ...message, ...statusUpdate };
    }

    if (
      previous &&
      getStatusRank(previous.status) > getStatusRank(message.status)
    ) {
      message = {
        ...message,
        status: previous.status,
        deliveredAt: message.deliveredAt ?? previous.deliveredAt,
        readAt: message.readAt ?? previous.readAt,
      };
    }

    if (existingIndex === -1) {
      merged.push(message);
    } else {
      merged[existingIndex] = message;
    }
  }

  return merged.sort((first, second) => {
    const firstTime = new Date(first.createdAt || 0).getTime();
    const secondTime = new Date(second.createdAt || 0).getTime();
    return firstTime - secondTime;
  });
}

function formatFileSize(bytes = 0) {
  if (!bytes) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function Chat() {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [me, setMe] = useState(null);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState === "visible",
  );

  const socketRef = useRef(null);
  const selectedRef = useRef(userId);
  const meRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const filePreviewUrlRef = useRef("");
  const pendingSocketMessagesRef = useRef([]);
  const pendingReadIdsRef = useRef(new Set());
  const pendingDeliveryIdsRef = useRef(new Set());
  const statusUpdatesRef = useRef({});

  // Keep the currently selected user available to Socket.IO callbacks.
  useEffect(() => {
    selectedRef.current = userId;
  }, [userId]);

  const clearAttachment = useCallback(() => {
    if (filePreviewUrlRef.current) {
      URL.revokeObjectURL(filePreviewUrlRef.current);
      filePreviewUrlRef.current = "";
    }

    setSelectedFile(null);
    setFilePreview("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  useEffect(
    () => () => {
      if (filePreviewUrlRef.current) {
        URL.revokeObjectURL(filePreviewUrlRef.current);
      }
    },
    [],
  );

  // Load the logged-in user, selected user, and conversation history.
  useEffect(() => {
    let active = true;
    const token = localStorage.getItem("token");

    async function loadChat() {
      if (!token) {
        navigate("/login");
        return;
      }

      setLoading(true);
      setError("");
      setSelected(null);
      setMessages([]);
      clearAttachment();
      setText("");

      pendingReadIdsRef.current.clear();
      pendingDeliveryIdsRef.current.clear();
      statusUpdatesRef.current = {};

      try {
        const headers = {
          Authorization: `Bearer ${token}`,
        };

        const [usersResponse, messagesResponse] = await Promise.all([
          fetch(`${API}/api/chat/users`, { headers }),
          fetch(`${API}/api/chat/${userId}/messages`, { headers }),
        ]);

        const usersData = await usersResponse.json();
        const messagesData = await messagesResponse.json();

        if (usersResponse.status === 401 || messagesResponse.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }

        if (!usersResponse.ok) {
          throw new Error(usersData.message || "Unable to load user details");
        }

        if (!messagesResponse.ok) {
          throw new Error(messagesData.message || "Unable to load messages");
        }

        const currentUser = usersData.me;

        const otherUser = (usersData.users || []).find(
          (user) => String(getId(user)) === String(userId),
        );

        if (!currentUser) {
          throw new Error("Logged-in user details not found");
        }

        if (!otherUser) {
          throw new Error("Selected user not found");
        }

        if (!active) return;

        setMe(currentUser);
        setSelected(otherUser);

        const loadedMessages = Array.isArray(messagesData)
          ? messagesData
          : messagesData.messages || [];

        setMessages((previous) =>
          mergeMessages(previous, loadedMessages, statusUpdatesRef.current),
        );
      } catch (err) {
        if (active) {
          setError(err.message || "Chat could not be loaded.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadChat();

    return () => {
      active = false;
    };
  }, [userId, navigate, clearAttachment]);

  const addOrUpdateMessages = useCallback((incomingMessages) => {
    setMessages((previous) =>
      mergeMessages(previous, incomingMessages, statusUpdatesRef.current),
    );
  }, []);

  // Mark an incoming message as DELIVERED.
  const markMessageDelivered = useCallback((message) => {
    const myId = meRef.current;
    const socket = socketRef.current;

    if (!myId || !socket?.connected) return;

    if (String(getReceiverId(message)) !== String(myId)) return;

    const messageId = getValidMessageId(message);

    if (!messageId) return;

    if (pendingDeliveryIdsRef.current.has(messageId)) return;

    pendingDeliveryIdsRef.current.add(messageId);

    console.log("Sending message_delivered event:", messageId);

    socket.emit("message_delivered", { messageId }, (result) => {
      pendingDeliveryIdsRef.current.delete(messageId);

      console.log("Delivery acknowledgement:", result);

      if (!result?.success) {
        console.error("Delivery failed:", result?.message);
        return;
      }

      console.log("Message marked DELIVERED:", messageId);

      const deliveredAt = new Date().toISOString();

      statusUpdatesRef.current[String(messageId)] = {
        status: "DELIVERED",
        deliveredAt,
      };

      setMessages((previous) =>
        previous.map((item) => {
          if (String(getMessageId(item)) !== String(messageId)) {
            return item;
          }

          // Never downgrade an already READ message.
          if (getStatusRank(item.status) >= getStatusRank("DELIVERED")) {
            return item;
          }

          return {
            ...item,
            status: "DELIVERED",
            deliveredAt,
          };
        }),
      );
    });
  }, []);

  const processIncomingMessage = useCallback(
    (message) => {
      const myId = meRef.current;

      if (!myId) {
        pendingSocketMessagesRef.current.push(message);
        return;
      }

      const senderId = getSenderId(message);
      const receiverId = getReceiverId(message);

      const isForMe = String(receiverId) === String(myId);

      const belongsToOpenChat =
        (String(senderId) === String(myId) &&
          String(receiverId) === String(selectedRef.current)) ||
        (isForMe && String(senderId) === String(selectedRef.current));

      if (isForMe) {
        markMessageDelivered(message);
      }

      if (belongsToOpenChat) {
        addOrUpdateMessages([message]);
      }
    },
    [addOrUpdateMessages, markMessageDelivered],
  );

  // Mark only DELIVERED messages as READ.
  const markMessagesRead = useCallback(
    (unreadMessages) => {
      const socket = socketRef.current;
      const myId = meRef.current;

      if (!socket?.connected || !myId || !pageVisible) return;

      const messageIds = unreadMessages
        .filter(
          (message) =>
            String(getReceiverId(message)) === String(myId) &&
            String(getSenderId(message)) !== String(myId) &&
            message.status === "DELIVERED",
        )
        .map(getValidMessageId)
        .filter(
          (messageId) => messageId && !pendingReadIdsRef.current.has(messageId),
        );

      if (messageIds.length === 0) return;

      messageIds.forEach((messageId) =>
        pendingReadIdsRef.current.add(messageId),
      );

      socket.emit("message_read", { messageIds }, (result) => {
        messageIds.forEach((messageId) =>
          pendingReadIdsRef.current.delete(messageId),
        );

        if (!result?.success) {
          setError(result?.message || "Messages could not be marked as read.");
          return;
        }

        const readAt = new Date().toISOString();

        messageIds.forEach((messageId) => {
          statusUpdatesRef.current[String(messageId)] = {
            status: "READ",
            readAt,
          };
        });

        const readIdSet = new Set(messageIds.map(String));

        setMessages((previous) =>
          previous.map((message) =>
            readIdSet.has(String(getMessageId(message)))
              ? { ...message, status: "READ", readAt }
              : message,
          ),
        );
      });
    },
    [pageVisible],
  );

  useEffect(() => {
    meRef.current = getId(me);

    if (!meRef.current) return;

    const pendingMessages = pendingSocketMessagesRef.current;

    pendingSocketMessagesRef.current = [];

    pendingMessages.forEach(processIncomingMessage);
  }, [me, processIncomingMessage]);

  // Connect Socket.IO and receive real-time messages.
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      navigate("/login");
      return undefined;
    }

    const socket = getChatSocket(token);

    socketRef.current = socket;
    let active = true;

    function onConnect() {
      console.log("Chat socket connected:", socket.id);
      setStatus("Connected");
    }

    function onDisconnect() {
      setStatus("Disconnected");
    }

    function onConnectError(err) {
      setStatus("Connection failed");
      setError(err.message || "Socket connection failed");

      if (
        /authentication required|invalid (or expired )?token|user not found/i.test(
          err.message || "",
        )
      ) {
        disconnectChatSocket(socket);
        localStorage.removeItem("token");
        navigate("/login");
      }
    }

    function onOnlineUsers(userIds) {
      setOnlineUserIds(
        new Set(
          (Array.isArray(userIds) ? userIds : []).map((onlineUserId) =>
            String(onlineUserId),
          ),
        ),
      );
    }

    function onUserStatusChanged(update) {
      if (!update?.userId || !["ONLINE", "OFFLINE"].includes(update.status)) {
        return;
      }

      setOnlineUserIds((previous) => {
        const next = new Set(previous);
        const onlineUserId = String(update.userId);

        if (update.status === "ONLINE") {
          next.add(onlineUserId);
        } else {
          next.delete(onlineUserId);
        }

        return next;
      });
    }

    function onNewMessage(message) {
      console.log("New message received:", message);
      processIncomingMessage(message);
    }

    function onMessageStatusUpdated(update) {
      const updatedStatus = update?.status;

      if (updatedStatus !== "DELIVERED" && updatedStatus !== "READ") {
        return;
      }

      const rawIds = Array.isArray(update.messageIds)
        ? update.messageIds
        : [update.messageId];

      const messageIds = rawIds
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0);

      if (messageIds.length === 0) return;

      const statusUpdate = {
        status: updatedStatus,
        ...(update.deliveredAt ? { deliveredAt: update.deliveredAt } : {}),
        ...(update.readAt ? { readAt: update.readAt } : {}),
      };

      messageIds.forEach((messageId) => {
        const key = String(messageId);
        const previousUpdate = statusUpdatesRef.current[key];

        if (
          !previousUpdate ||
          getStatusRank(updatedStatus) > getStatusRank(previousUpdate.status)
        ) {
          statusUpdatesRef.current[key] = statusUpdate;
        }
      });

      const messageIdSet = new Set(messageIds.map(String));

      setMessages((previous) =>
        previous.map((message) => {
          if (!messageIdSet.has(String(getMessageId(message)))) {
            return message;
          }

          if (getStatusRank(updatedStatus) <= getStatusRank(message.status)) {
            return message;
          }

          return { ...message, ...statusUpdate };
        }),
      );
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("online_users", onOnlineUsers);
    socket.on("user_status_changed", onUserStatusChanged);
    socket.on("new_message", onNewMessage);
    socket.on("message_status_updated", onMessageStatusUpdated);

    socket.connect();

    if (socket.connected) {
      queueMicrotask(() => {
        if (active && socket.connected) {
          setStatus("Connected");
        }
      });
      socket.emit("get_online_users");
    }

    return () => {
      active = false;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("online_users", onOnlineUsers);
      socket.off("user_status_changed", onUserStatusChanged);
      socket.off("new_message", onNewMessage);
      socket.off("message_status_updated", onMessageStatusUpdated);

      socketRef.current = null;
    };
  }, [navigate, processIncomingMessage]);

  // Handle browser tab visibility.
  useEffect(() => {
    function onVisibilityChange() {
      setPageVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Handle historical SENT messages after the socket connects.
  useEffect(() => {
    if (loading || status !== "Connected" || !meRef.current) {
      return;
    }

    console.log("Checking historical SENT messages...");

    messages.forEach((message) => {
      const isIncoming =
        String(getReceiverId(message)) === String(meRef.current) &&
        String(getSenderId(message)) !== String(meRef.current);

      if (isIncoming && message.status === "SENT") {
        console.log("Historical SENT message found:", getMessageId(message));

        markMessageDelivered(message);
      }
    });
  }, [messages, loading, status, markMessageDelivered]);

  // Mark DELIVERED messages as READ when the page is visible.
  useEffect(() => {
    if (!loading && pageVisible) {
      markMessagesRead(messages);
    }
  }, [messages, loading, pageVisible, status, markMessagesRead]);

  // Automatically scroll to the latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  // Select an attachment locally; do not upload it yet.
  function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File size must not exceed 10 MB.");
      event.target.value = "";
      return;
    }

    setError("");

    if (filePreviewUrlRef.current) {
      URL.revokeObjectURL(filePreviewUrlRef.current);
      filePreviewUrlRef.current = "";
    }

    if (file.type.startsWith("image/")) {
      filePreviewUrlRef.current = URL.createObjectURL(file);

      setFilePreview(filePreviewUrlRef.current);
    } else {
      setFilePreview("");
    }

    setSelectedFile(file);
  }

  function removeAttachment() {
    clearAttachment();
  }

  // Send text only through Socket.IO.
  function sendTextMessage(messageText) {
    const socket = socketRef.current;

    if (!socket?.connected) {
      setError("Socket is disconnected. Please wait and try again.");
      return;
    }

    setSending(true);
    setError("");

    socket.timeout(10000).emit(
      "send_message",
      {
        receiverId: getId(selected),
        text: messageText,
      },
      (timeoutError, result) => {
        setSending(false);

        if (timeoutError) {
          setError("Message sending timed out. Please try again.");
          return;
        }

        if (!result?.success) {
          setError(result?.message || "Message could not be sent.");
          return;
        }

        const savedMessage = result.message;

        addOrUpdateMessages([savedMessage]);

        setText("");
      },
    );
  }

  // If a file is attached, upload it only after Send is clicked.
  async function sendMessage(event) {
    event.preventDefault();

    const messageText = text.trim();

    if (!selected || (!messageText && !selectedFile) || sending) {
      return;
    }

    setError("");

    if (!selectedFile) {
      sendTextMessage(messageText);
      return;
    }

    const token = localStorage.getItem("token");

    if (!token) {
      navigate("/login");
      return;
    }

    setSending(true);

    try {
      const formData = new FormData();

      formData.append("file", selectedFile);
      formData.append("text", messageText);

      const response = await fetch(
        `${API}/api/chat/${getId(selected)}/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      const data = await response.json();

      if (response.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "File could not be sent.");
      }

      const savedMessage =
        data.file ||
        data.savedMessage ||
        (typeof data.message === "object" ? data.message : null);

      if (!savedMessage) {
        throw new Error(
          "Upload succeeded, but the saved message was missing from the response.",
        );
      }

      addOrUpdateMessages([savedMessage]);

      setText("");
      clearAttachment();
    } catch (err) {
      setError(err.message || "Failed to send attachment.");
    } finally {
      setSending(false);
    }
  }

  const canSend =
    Boolean(text.trim() || selectedFile) &&
    Boolean(selected) &&
    !loading &&
    !sending &&
    (Boolean(selectedFile) || status === "Connected");

  return (
    <div className="min-h-screen bg-gradient-to-br from-lime-50 via-white to-emerald-50 p-0 sm:p-5 lg:p-8">
      <div className="mx-auto flex h-[100dvh] max-w-5xl flex-col overflow-hidden bg-white shadow-xl shadow-lime-900/5 sm:h-[calc(100dvh-2.5rem)] sm:rounded-3xl sm:border sm:border-lime-100 lg:h-[calc(100dvh-4rem)]">
        {/* Chat Header */}
        <header className="flex shrink-0 items-center gap-3 border-b border-lime-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label="Back to users"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition hover:border-lime-200 hover:bg-lime-50 hover:text-lime-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="21"
              height="21"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
              <path d="M20 12H9" />
            </svg>
          </button>

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-200 to-emerald-200 text-lg font-extrabold text-lime-800">
            {(selected?.Fullname || "U").charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-bold text-gray-800 sm:text-lg">
              {selected?.Fullname || "Loading chat..."}
            </h1>

            {selected?.Email && (
              <p className="truncate text-xs text-gray-500 sm:text-sm">
                {selected.Email}
              </p>
            )}

            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  selected && onlineUserIds.has(String(getId(selected)))
                    ? "bg-emerald-500"
                    : "bg-gray-300"
                }`}
              />

              <span
                className={`text-xs font-medium ${
                  selected && onlineUserIds.has(String(getId(selected)))
                    ? "text-emerald-600"
                    : "text-gray-500"
                }`}
              >
                {!selected
                  ? "Loading status..."
                  : onlineUserIds.has(String(getId(selected)))
                    ? "Online"
                    : "Offline"}
              </span>
            </div>
          </div>

          {/* Current User */}
          <div className="hidden items-center gap-2 rounded-xl bg-lime-50 px-3 py-2 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-lime-200 text-sm font-bold text-lime-800">
              {(me?.Fullname || "U").charAt(0).toUpperCase()}
            </div>

            <div className="max-w-28">
              <p className="truncate text-xs font-semibold text-gray-700">
                {me?.Fullname || "You"}
              </p>
              <p className="text-xs text-gray-500">Your account</p>
            </div>
          </div>
        </header>

        {/* Chat Messages */}
        <main className="flex-1 space-y-5 overflow-y-auto bg-[#f7faf5] p-4 sm:p-6 lg:p-8">
          {!loading && !error && selected && (
            <div className="flex justify-center">
              <div className="rounded-full border border-lime-100 bg-white px-4 py-2 text-center text-xs text-gray-500 shadow-sm">
                <span className="font-semibold text-lime-700">
                  {selected.Fullname || "User"}
                </span>{" "}
                • Your conversation
              </div>
            </div>
          )}

          {loading && (
            <div className="flex h-full min-h-48 flex-col items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-lime-100 border-t-lime-600" />
              <p className="mt-4 text-sm font-medium text-gray-600">
                Loading conversation...
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Getting your messages ready
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-red-100 bg-white p-5 text-center shadow-sm">
              <p className="text-sm font-semibold text-red-700">
                Something went wrong
              </p>
              <p className="mt-1 break-words text-sm text-gray-600">{error}</p>
              <button
                type="button"
                onClick={() => setError("")}
                className="mt-3 text-xs font-semibold text-lime-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center py-10 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-lime-100 to-emerald-100 text-lime-700">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>

              <h2 className="mt-5 text-lg font-bold text-gray-800">
                Start a conversation
              </h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-gray-500">
                Say hello to {selected?.Fullname || "your friend"}. Your
                messages will appear here.
              </p>
              <span className="mt-4 rounded-full bg-lime-100 px-4 py-2 text-xs font-semibold text-lime-800">
                Your chat starts here 💚
              </span>
            </div>
          )}

          {!loading &&
            messages.map((message) => {
              const mine = String(getSenderId(message)) === String(getId(me));

              const messageId = getMessageId(message);
              const imageFile = message.fileType?.startsWith("image/");

              return (
                <div
                  key={messageId}
                  className={`flex items-end gap-2 ${
                    mine ? "justify-end" : "justify-start"
                  }`}
                >
                  {!mine && (
                    <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-lime-100 text-xs font-bold text-lime-800">
                      {(selected?.Fullname || "U").charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div
                    className={`max-w-[82%] break-words px-4 py-3 shadow-sm sm:max-w-[70%] ${
                      mine
                        ? "rounded-2xl rounded-br-sm bg-gradient-to-br from-lime-600 to-emerald-600 text-white"
                        : "rounded-2xl rounded-bl-sm border border-gray-100 bg-white text-gray-800"
                    }`}
                  >
                    {/* Previously sent attachment */}
                    {message.fileUrl && (
                      <div className="mb-2">
                        {imageFile ? (
                          <a
                            href={message.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block"
                          >
                            <img
                              src={message.fileUrl}
                              alt={message.fileName || "Shared image"}
                              className="max-h-64 w-full rounded-xl object-contain"
                            />
                          </a>
                        ) : (
                          <a
                            href={message.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            download={message.fileName || undefined}
                            className={`flex items-center gap-3 rounded-xl border p-3 ${
                              mine
                                ? "border-white/20 bg-white/10 hover:bg-white/20"
                                : "border-gray-200 bg-gray-50 hover:bg-lime-50"
                            }`}
                          >
                            <FileText size={25} className="shrink-0" />
                            <div className="min-w-0">
                              <p className="break-all text-sm font-semibold">
                                {message.fileName || "Attachment"}
                              </p>
                              <p className="mt-1 text-xs opacity-75">
                                {formatFileSize(message.fileSize)}
                              </p>
                            </div>
                          </a>
                        )}

                        {message.fileName && imageFile && (
                          <p className="mt-1 break-all text-xs opacity-80">
                            {message.fileName}
                          </p>
                        )}
                      </div>
                    )}

                    {message.text && (
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 sm:text-[15px]">
                        {message.text}
                      </p>
                    )}

                    <div
                      className={`mt-1.5 text-right text-[10px] ${
                        mine ? "text-lime-100" : "text-gray-400"
                      } flex items-center justify-end gap-1`}
                    >
                      <span>
                        {message.createdAt
                          ? new Date(message.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>

                      {mine && (
                        <span
                          aria-label={`${message.status || "SENT"} status`}
                          title={message.status || "SENT"}
                          className={
                            message.status === "READ"
                              ? "font-bold text-sky-300"
                              : "font-bold text-gray-300"
                          }
                        >
                          {message.status === "DELIVERED" ||
                          message.status === "READ"
                            ? "✓✓"
                            : "✓"}
                        </span>
                      )}
                    </div>
                  </div>

                  {mine && (
                    <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-xs font-bold text-emerald-800">
                      {(me?.Fullname || "Y").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}

          <div ref={bottomRef} />
        </main>

        {/* Message Composer */}
        <footer className="shrink-0 border-t border-lime-100 bg-white p-3 sm:p-5">
          <form onSubmit={sendMessage} className="mx-auto max-w-4xl">
            {/* Pending attachment preview */}
            {selectedFile && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl border border-lime-200 bg-lime-50 p-3">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt="Selected attachment preview"
                    className="h-16 w-16 shrink-0 rounded-xl border border-lime-100 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white text-lime-700">
                    <FileText size={30} />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-800">
                    {selectedFile.name}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatFileSize(selectedFile.size)} · Ready to send
                  </p>
                  <p className="mt-1 text-xs text-lime-700">
                    File has not been uploaded yet
                  </p>
                </div>

                <button
                  type="button"
                  onClick={removeAttachment}
                  disabled={sending}
                  aria-label="Remove attachment"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-white hover:text-red-600 disabled:opacity-40"
                >
                  <X size={20} />
                </button>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              id="fileInput"
              type="file"
              className="hidden"
              onChange={handleFileChange}
              disabled={loading || !selected || sending}
            />

            <div className="flex items-end gap-2 sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-gray-200 bg-gray-50 px-2 transition focus-within:border-lime-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-lime-100 sm:px-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || !selected || sending}
                  aria-label="Attach a file"
                  title="Attach a file"
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-600 transition hover:bg-lime-100 hover:text-lime-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={24} />
                </button>

                <input
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Type your message..."
                  maxLength={5000}
                  disabled={loading || !selected || sending}
                  className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed sm:text-base"
                />

                <span className="hidden pl-2 text-xs text-gray-400 sm:inline">
                  {text.length}/5000
                </span>
              </div>

              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                title="Send message"
                className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-lime-600 text-white shadow-md shadow-lime-200 transition hover:bg-lime-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[52px] sm:w-auto sm:gap-2 sm:px-5"
              >
                <span className="hidden text-sm font-bold sm:inline">
                  {sending ? "Sending..." : "Send"}
                </span>

                {sending ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                )}
              </button>
            </div>
          </form>

          <p className="mt-3 text-center text-[10px] text-gray-400 sm:text-xs">
            {selectedFile
              ? "Your attachment will upload when you press Send 💚"
              : "Send a message and keep the conversation going 💚"}
          </p>
        </footer>
      </div>
    </div>
  );
}
