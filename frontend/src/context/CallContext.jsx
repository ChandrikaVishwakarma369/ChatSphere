
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { getChatSocket, getChatTabId } from "../socket";

const CallContext = createContext(null);

const CALL_STORAGE_KEY = "activeWebRTCCall";

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
    {
      urls: "stun:stun1.l.google.com:19302",
    },
    {
      urls: "stun:stun2.l.google.com:19302",
    },
  ],
};

function waitForSocket(socket) {
  if (socket.connected) return Promise.resolve(socket);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Socket connection timed out."));
    }, 10000);

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);

    if (!socket.connected) socket.connect();
  });
}

function isMediaError(error) {
  return [
    "NotAllowedError",
    "PermissionDeniedError",
    "NotFoundError",
    "DevicesNotFoundError",
    "NotReadableError",
    "TrackStartError",
    "OverconstrainedError",
    "ConstraintNotSatisfiedError",
    "SecurityError",
    "TypeError",
  ].includes(error?.name);
}

function saveCallSession(call) {
  if (!call?.callId) return;

  try {
    sessionStorage.setItem(
      CALL_STORAGE_KEY,
      JSON.stringify({
        callId: call.callId,
        peerId: call.peerId,
        peerName: call.peerName || "User",
        video: call.video === true,
        role: call.role,
      }),
    );
  } catch (error) {
    console.error("Unable to save call session:", error);
  }
}

function readCallSession() {
  try {
    const value = sessionStorage.getItem(CALL_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error("Unable to read call session:", error);
    return null;
  }
}

function clearCallSession() {
  sessionStorage.removeItem(CALL_STORAGE_KEY);
}

export function CallProvider({ children }) {
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callInAnotherTab, setCallInAnotherTab] = useState(null);

  const broadcastChannelRef = useRef(null);
  const recoveryPreparingRef = useRef(new Set());
  const recoveryPreparedRef = useRef(new Set());

  const [muted, setMuted] = useState(
    () => sessionStorage.getItem("callMuted") === "true",
  );

  const [cameraOff, setCameraOff] = useState(
    () => sessionStorage.getItem("callCameraOff") === "true",
  );

  const [callError, setCallError] = useState("");

  const [permissionDialog, setPermissionDialog] = useState({
    open: false,
    title: "",
    message: "",
  });

  const socketRef = useRef(null);
  const callRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const iceQueueRef = useRef([]);

  const listenersSocketRef = useRef(null);

  const updateCall = useCallback((nextCall) => {
    callRef.current = nextCall;
    setCall(nextCall);

    if (nextCall?.callId) {
      saveCallSession(nextCall);

      broadcastChannelRef.current?.postMessage({
        type: "CALL_STARTED",
        tabId: getChatTabId(),
        callId: nextCall.callId,
        peerName: nextCall.peerName || "User",
        video: nextCall.video === true,
        role: nextCall.role,
      });

      setCallInAnotherTab(null);
    }
  }, []);

  // Synchronize call state between browser tabs.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel("chat-call-state");
    broadcastChannelRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data;

      if (!data || data.tabId === getChatTabId()) return;

      if (data.type === "CALL_STARTED") {
        setCallInAnotherTab({
          callId: data.callId,
          peerName: data.peerName || "User",
          video: data.video === true,
          role: data.role,
        });
      }

      if (data.type === "CALL_ENDED") {
        setCallInAnotherTab((previous) =>
          previous?.callId === data.callId ? null : previous,
        );
      }
    };

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  const handleMediaError = useCallback((error) => {
    console.error("Media permission error:", error);

    let title = "Camera and Microphone Access";
    let message =
      "Unable to access your camera or microphone. Please check your device settings.";

    switch (error?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        title = "Permission Required";
        message =
          "Camera or microphone access is blocked. Allow access in your browser settings and try again.";
        break;

      case "NotFoundError":
      case "DevicesNotFoundError":
        title = "Device Not Found";
        message =
          "No microphone or camera was detected. Connect a device and check your Windows settings.";
        break;

      case "NotReadableError":
      case "TrackStartError":
        title = "Device Is Already in Use";
        message =
          "Your camera or microphone may be in use by another application. Close that application and try again.";
        break;

      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        title = "Device Unavailable";
        message = "The selected camera or microphone is unavailable.";
        break;

      case "SecurityError":
        title = "Secure Connection Required";
        message =
          "Camera and microphone access requires localhost or HTTPS.";
        break;

      default:
        break;
    }

    setPermissionDialog({ open: true, title, message });
  }, []);

  const closePermissionDialog = useCallback(() => {
    setPermissionDialog({
      open: false,
      title: "",
      message: "",
    });
  }, []);

  // Close the old peer connection without stopping local media.
  const resetPeerConnection = useCallback(() => {
    const peer = peerConnectionRef.current;

    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
      peerConnectionRef.current = null;
    }

    remoteStreamRef.current = null;
    iceQueueRef.current = [];
    setRemoteStream(null);
  }, []);

  const cleanupCall = useCallback(() => {
    const previousCall = callRef.current;

    if (previousCall?.callId) {
      broadcastChannelRef.current?.postMessage({
        type: "CALL_ENDED",
        tabId: getChatTabId(),
        callId: previousCall.callId,
      });
    }

    resetPeerConnection();

    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStreamRef.current = null;
    remoteStreamRef.current = null;

    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);

    sessionStorage.removeItem("callMuted");
    sessionStorage.removeItem("callCameraOff");

    recoveryPreparingRef.current.clear();
    recoveryPreparedRef.current.clear();
    clearCallSession();

    callRef.current = null;
    setCall(null);
  }, [resetPeerConnection]);

  const createPeerConnection = useCallback(
    (callId) => {
      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      const socket = socketRef.current;
      const peer = new RTCPeerConnection(ICE_SERVERS);

      peerConnectionRef.current = peer;

      // Add local audio/video tracks.
      const stream = localStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => {
          if (track.readyState === "live") {
            peer.addTrack(track, stream);
          }
        });
      }

      // Send ICE candidates to the other participant.
      peer.onicecandidate = (event) => {
        if (event.candidate && socket?.connected) {
          socket.emit("ice_candidate", {
            callId,
            candidate: event.candidate,
          });
        }
      };

      peer.onicecandidateerror = (event) => {
        console.error("ICE CANDIDATE ERROR:", {
          url: event.url,
          errorCode: event.errorCode,
          errorText: event.errorText,
        });
      };

      // Receive remote audio/video tracks.
      peer.ontrack = (event) => {
        let stream = event.streams?.[0];

        if (!stream) {
          stream = remoteStreamRef.current || new MediaStream();

          const alreadyAdded = stream
            .getTracks()
            .some((track) => track.id === event.track.id);

          if (!alreadyAdded) {
            stream.addTrack(event.track);
          }
        }

        remoteStreamRef.current = stream;
        setRemoteStream(stream);
      };

      // WebRTC connection state.
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setCallError("");

          updateCall({
            ...callRef.current,
            status: "ACCEPTED",
            reconnecting: false,
          });
        }

        if (peer.connectionState === "failed") {
          setCallError(
            "WebRTC connection failed. Please try reconnecting.",
          );
        }
      };

      return peer;
    },
    [updateCall],
  );

  const addQueuedCandidates = useCallback(async (peer) => {
    const candidates = [...iceQueueRef.current];
    iceQueueRef.current = [];

    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Queued ICE candidate error:", error);
      }
    }
  }, []);

  const createOffer = useCallback(
    async (callId) => {
      try {
        const currentCall = callRef.current;

        if (
          !currentCall ||
          currentCall.callId !== callId ||
          currentCall.role !== "caller"
        ) {
          return;
        }

        const peer = createPeerConnection(callId);

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        const socket = socketRef.current;

        if (!socket?.connected) {
          throw new Error("Socket disconnected while creating offer.");
        }

        socket.emit(
          "webrtc_offer",
          {
            callId,
            offer: peer.localDescription,
          },
          (result) => {
            if (!result?.success) {
              setCallError(result?.message || "Offer could not be sent.");
            }
          },
        );

        updateCall({
          ...callRef.current,
          status: "CONNECTING",
          reconnecting: false,
        });
      } catch (error) {
        console.error("Offer creation error:", error);
        setCallError("Unable to create WebRTC offer.");
      }
    },
    [createPeerConnection, updateCall],
  );

  const handleOffer = useCallback(
    async (data) => {
      try {
        const currentCall = callRef.current;

        if (
          !currentCall ||
          currentCall.callId !== data.callId ||
          currentCall.role !== "callee"
        ) {
          return;
        }

        const peer = createPeerConnection(data.callId);

        await peer.setRemoteDescription(
          new RTCSessionDescription(data.offer),
        );

        await addQueuedCandidates(peer);

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        socketRef.current.emit(
          "webrtc_answer",
          {
            callId: data.callId,
            answer: peer.localDescription,
          },
          (result) => {
            if (!result?.success) {
              setCallError(result?.message || "Answer could not be sent.");
            }
          },
        );

        updateCall({
          ...currentCall,
          status: "CONNECTING",
          reconnecting: false,
        });
      } catch (error) {
        console.error("Offer handling error:", error);
        setCallError("Unable to process the call offer.");
      }
    },
    [createPeerConnection, addQueuedCandidates, updateCall],
  );

  const handleAnswer = useCallback(
    async (data) => {
      try {
        const currentCall = callRef.current;

        if (!currentCall || currentCall.callId !== data.callId) {
          return;
        }

        const peer = peerConnectionRef.current;

        if (!peer) return;

        await peer.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );

        await addQueuedCandidates(peer);

        updateCall({
          ...currentCall,
          status: "CONNECTING",
          reconnecting: false,
        });
      } catch (error) {
        console.error("Answer handling error:", error);
        setCallError("Unable to process the call answer.");
      }
    },
    [addQueuedCandidates, updateCall],
  );

  const handleIceCandidate = useCallback(async (data) => {
    const currentCall = callRef.current;

    if (!currentCall || currentCall.callId !== data.callId) {
      return;
    }

    const peer = peerConnectionRef.current;

    if (!peer || !peer.remoteDescription) {
      iceQueueRef.current.push(data.candidate);
      return;
    }

    try {
      await peer.addIceCandidate(
        new RTCIceCandidate(data.candidate),
      );
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  }, []);

  // Restore local media and prepare a fresh peer connection.
  const prepareCallRecovery = useCallback(
    async (callId) => {
      const currentCall = callRef.current;
      const socket = socketRef.current;

      if (
        !currentCall ||
        currentCall.callId !== callId ||
        !["ACCEPTED", "CONNECTING"].includes(currentCall.status) ||
        !socket?.connected
      ) {
        return;
      }

      // Each newly connected socket gets its own recovery preparation.
      const recoveryKey = `${callId}:${socket.id}`;

      if (
        recoveryPreparingRef.current.has(recoveryKey) ||
        recoveryPreparedRef.current.has(recoveryKey)
      ) {
        return;
      }

      recoveryPreparingRef.current.add(recoveryKey);

      try {
        setCallError("");

        let stream = localStreamRef.current;

        const hasLiveAudio = stream
          ?.getAudioTracks()
          .some((track) => track.readyState === "live");

        const hasLiveVideo =
          currentCall.video !== true ||
          stream
            ?.getVideoTracks()
            .some((track) => track.readyState === "live");

        if (!hasLiveAudio || !hasLiveVideo) {
          stream?.getTracks().forEach((track) => track.stop());

          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: currentCall.video === true,
          });

          applySavedMediaPreferences(stream);

          localStreamRef.current = stream;
          setLocalStream(stream);
        }

        // Create one fresh peer connection for this recovery attempt.
        resetPeerConnection();
        createPeerConnection(callId);

        updateCall({
          ...callRef.current,
          reconnecting: true,
          status: "ACCEPTED",
        });

        // Wait for the server acknowledgement before releasing the lock.
        await new Promise((resolve, reject) => {
          socket.timeout(10000).emit(
            "call_recovery_ready",
            { callId },
            (timeoutError, response) => {
              if (timeoutError) {
                reject(new Error("Call recovery server timed out."));
                return;
              }

              if (!response?.success) {
                reject(
                  new Error(
                    response?.message || "Call recovery preparation failed.",
                  ),
                );
                return;
              }

              resolve(response);
            },
          );
        });

        recoveryPreparedRef.current.add(recoveryKey);
      } catch (error) {
        console.error("Call recovery error:", error);

        if (isMediaError(error)) {
          handleMediaError(error);
        } else {
          setCallError(error.message || "Unable to restore the call.");
        }
      } finally {
        recoveryPreparingRef.current.delete(recoveryKey);
      }
    },
    [
      resetPeerConnection,
      createPeerConnection,
      updateCall,
      handleMediaError,
    ],
  );

  const connectCallSocket = useCallback(() => {
    const token = localStorage.getItem("token");

    if (!token) return null;

    const socket = getChatSocket(token);

    socketRef.current = socket;

    if (listenersSocketRef.current !== socket) {
      if (listenersSocketRef.current) {
        listenersSocketRef.current.removeAllListeners("incoming_call");
        listenersSocketRef.current.removeAllListeners(
          "call_active_in_another_tab",
        );
        listenersSocketRef.current.removeAllListeners("call_accepted");
        listenersSocketRef.current.removeAllListeners("webrtc_offer");
        listenersSocketRef.current.removeAllListeners("webrtc_answer");
        listenersSocketRef.current.removeAllListeners("ice_candidate");
        listenersSocketRef.current.removeAllListeners("call_restored");
        listenersSocketRef.current.removeAllListeners(
          "call_peer_disconnected",
        );
        listenersSocketRef.current.removeAllListeners(
          "call_peer_reconnected",
        );
        listenersSocketRef.current.removeAllListeners(
          "call_recovery_start",
        );
        listenersSocketRef.current.removeAllListeners("call_rejected");
        listenersSocketRef.current.removeAllListeners("call_ended");
        listenersSocketRef.current.removeAllListeners("call_busy");
      }

      listenersSocketRef.current = socket;

      socket.on("incoming_call", (data) => {
        if (callRef.current) {
          socket.emit("call_rejected", { callId: data.callId });
          return;
        }

        const nextCall = {
          callId: data.callId,
          peerId: data.callerId,
          peerName: data.callerName || "User",
          video: data.video === true,
          role: "callee",
          status: "RINGING",
        };

        updateCall(nextCall);
      });

      socket.on("call_active_in_another_tab", (data) => {
        if (!data?.callId) return;

        setCallInAnotherTab({
          callId: data.callId,
          video: data.video === true,
          role: data.role,
          peerName: "User",
        });
      });

      socket.on("call_accepted", (data) => {
        if (callRef.current?.callId === data.callId) {
          createOffer(data.callId);
        }
      });

      socket.on("webrtc_offer", handleOffer);
      socket.on("webrtc_answer", handleAnswer);
      socket.on("ice_candidate", handleIceCandidate);

      socket.on("call_restored", (data) => {
        const savedCall = readCallSession();

        if (!savedCall || savedCall.callId !== data.callId) {
          return;
        }

        const restoredCall = {
          ...savedCall,
          callId: data.callId,
          peerId:
            data.role === "caller" ? data.receiverId : data.callerId,
          video: data.video === true,
          role: data.role,
          status: data.status,
          reconnecting: data.status === "ACCEPTED",
        };

        updateCall(restoredCall);

        if (data.status === "ACCEPTED") {
          prepareCallRecovery(data.callId);
        }
      });

      socket.on("call_peer_disconnected", (data) => {
        const currentCall = callRef.current;

        if (currentCall?.callId !== data.callId) return;

        updateCall({
          ...currentCall,
          reconnecting: true,
        });
      });

      socket.on("call_peer_reconnected", (data) => {
        const currentCall = callRef.current;
        const activeSocket = socketRef.current;

        if (
          !data?.callId ||
          currentCall?.callId !== data.callId ||
          !["ACCEPTED", "CONNECTING"].includes(currentCall.status) ||
          !activeSocket?.connected
        ) {
          return;
        }

        // The backend resets recovery readiness for BOTH participants.
        // Therefore, the participant whose socket did not change must
        // also prepare a fresh peer connection.
        const recoveryKey = `${data.callId}:${activeSocket.id}`;

        recoveryPreparedRef.current.delete(recoveryKey);

        prepareCallRecovery(data.callId);
      });

      socket.on("call_recovery_start", (data) => {
        const currentCall = callRef.current;

        if (
          currentCall?.callId === data.callId &&
          currentCall.role === "caller"
        ) {
          createOffer(data.callId);
        }
      });

      socket.on("call_rejected", (data) => {
        if (!data?.callId || callRef.current?.callId === data.callId) {
          setCallError("The other user rejected your call.");
          cleanupCall();
        }
      });

      socket.on("call_ended", (data) => {
        if (!data?.callId) return;

        setCallInAnotherTab((previous) =>
          previous?.callId === data.callId ? null : previous,
        );

        if (callRef.current?.callId === data.callId) {
          cleanupCall();
        }
      });

      socket.on("call_busy", () => {
        setCallError("The other user is busy.");
        cleanupCall();
      });

      socket.on("connect_error", (error) => {
        console.error("Call socket connection error:", error.message);
      });
    }

    if (!socket.connected) {
      socket.connect();
    }

    return socket;
  }, [
    updateCall,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    prepareCallRecovery,
    cleanupCall,
  ]);

  // Automatically connect after login/page refresh.
  useEffect(() => {
    if (localStorage.getItem("token")) {
      connectCallSocket();
    }
  }, [connectCallSocket]);

  const applySavedMediaPreferences = (stream) => {
    const savedMuted =
      sessionStorage.getItem("callMuted") === "true";

    const savedCameraOff =
      sessionStorage.getItem("callCameraOff") === "true";

    stream.getAudioTracks().forEach((track) => {
      track.enabled = !savedMuted;
    });

    stream.getVideoTracks().forEach((track) => {
      track.enabled = !savedCameraOff;
    });

    setMuted(savedMuted);
    setCameraOff(savedCameraOff);
  };

  const startCall = useCallback(
    async (receiverId, video, peerName) => {
      try {
        setCallError("");
        closePermissionDialog();

        if (callRef.current) {
          setCallError("You are already in a call.");
          return;
        }

        if (callInAnotherTab) {
          setCallError("Your account is already in a call in another tab.");
          return;
        }

        const socket = connectCallSocket();

        if (!socket) {
          setCallError("Please login before starting a call.");
          return;
        }

        await waitForSocket(socket);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: video === true,
        });

        applySavedMediaPreferences(stream);

        localStreamRef.current = stream;
        setLocalStream(stream);

        socket.timeout(10000).emit(
          "call_user",
          {
            receiverId: Number(receiverId),
            video: video === true,
          },
          (timeoutError, result) => {
            if (timeoutError || !result?.success) {
              stream.getTracks().forEach((track) => track.stop());

              localStreamRef.current = null;
              setLocalStream(null);

              setCallError(
                result?.message || "Call could not be initiated.",
              );

              return;
            }

            updateCall({
              callId: result.callId,
              peerId: String(receiverId),
              peerName: peerName || "User",
              video: video === true,
              role: "caller",
              status: "RINGING",
              reconnecting: false,
            });
          },
        );
      } catch (error) {
        console.error("Start call error:", error);

        if (isMediaError(error)) {
          handleMediaError(error);
        } else {
          setCallError(error.message || "Unable to initialize the call.");
        }

        cleanupCall();
      }
    },
    [
      connectCallSocket,
      updateCall,
      cleanupCall,
      closePermissionDialog,
      handleMediaError,
      callInAnotherTab,
    ],
  );

  const acceptCall = useCallback(async () => {
    const currentCall = callRef.current;

    if (!currentCall || currentCall.role !== "callee") return;

    try {
      setCallError("");
      closePermissionDialog();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: currentCall.video === true,
      });

      applySavedMediaPreferences(stream);

      localStreamRef.current = stream;
      setLocalStream(stream);

      socketRef.current.emit(
        "call_accepted",
        { callId: currentCall.callId },
        (result) => {
          if (!result?.success) {
            setCallError(result?.message || "Call could not be accepted.");
            cleanupCall();
            return;
          }

          updateCall({
            ...callRef.current,
            status: "ACCEPTED",
          });
        },
      );
    } catch (error) {
      console.error("Accept call error:", error);

      if (isMediaError(error)) {
        handleMediaError(error);
      } else {
        setCallError(error.message || "Unable to initialize the call.");
      }

      cleanupCall();
    }
  }, [
    updateCall,
    cleanupCall,
    closePermissionDialog,
    handleMediaError,
  ]);

  const rejectCall = useCallback(() => {
    const currentCall = callRef.current;

    if (!currentCall) return;

    socketRef.current?.emit("call_rejected", {
      callId: currentCall.callId,
    });

    cleanupCall();
  }, [cleanupCall]);

  const endCall = useCallback(() => {
    const currentCall = callRef.current;

    if (currentCall) {
      socketRef.current?.emit("end_call", {
        callId: currentCall.callId,
      });
    }

    cleanupCall();
  }, [cleanupCall]);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    setMuted(nextMuted);
    sessionStorage.setItem("callMuted", String(nextMuted));
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const nextCameraOff = !cameraOff;

    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });

    setCameraOff(nextCameraOff);
    sessionStorage.setItem("callCameraOff", String(nextCameraOff));
  }, [cameraOff]);

  return (
    <CallContext.Provider
      value={{
        call,
        localStream,
        remoteStream,
        muted,
        cameraOff,
        callError,
        permissionDialog,
        closePermissionDialog,
        connectCallSocket,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleCamera,
        callInAnotherTab,
      }}
    >
      {children}

      {permissionDialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-lime-100">
              <span className="text-3xl">🎙️</span>
            </div>

            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              {permissionDialog.title}
            </h2>

            <p className="mb-6 text-sm leading-6 text-gray-600">
              {permissionDialog.message}
            </p>

            <button
              type="button"
              onClick={closePermissionDialog}
              className="w-full rounded-xl bg-lime-600 px-5 py-3 font-medium text-white transition hover:bg-lime-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);

  if (!context) {
    throw new Error("useCall must be used inside CallProvider");
  }

  return context;
}
