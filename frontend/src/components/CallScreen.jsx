
import { useEffect, useRef } from "react";
import {
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from "lucide-react";

import { useCall } from "../context/CallContext";

export default function CallScreen() {
  const {
    call,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    callError,
    toggleMute,
    toggleCamera,
    endCall,
  } = useCall();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream || null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream || null;
    }
  }, [localStream, remoteStream]);

  if (!call && !callError) return null;

  if (!call) {
    return (
      <div className="fixed bottom-5 right-5 z-[110] rounded-xl bg-red-600 px-5 py-3 text-sm text-white shadow-lg">
        {callError}
      </div>
    );
  }

  // Outgoing caller ringing screen
  if (call.status === "RINGING" && call.role === "caller") {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-gray-950 text-white">
        <div className="flex flex-col items-center gap-5">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-lime-700 text-4xl font-bold">
            {(call.peerName || "U").charAt(0).toUpperCase()}
          </div>

          <h2 className="text-2xl font-bold">
            {call.peerName || `User ${call.peerId}`}
          </h2>

          <p className="text-gray-400">
            {call.video ? "Video calling..." : "Audio calling..."}
          </p>

          <button
            type="button"
            onClick={endCall}
            className="mt-8 flex h-16 items-center gap-3 rounded-full bg-red-600 px-8 font-semibold text-white transition hover:bg-red-700"
            aria-label="Cancel call"
          >
            <PhoneOff size={22} />
            Cancel Call
          </button>
        </div>
      </div>
    );
  }

  // Keep the incoming receiver's existing ringing UI unchanged.
  if (call.status === "RINGING") return null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-gray-950 text-white">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 className="font-bold">
            {call.video ? "Video Call" : "Audio Call"}
          </h2>

          <p className="text-xs text-gray-400">
            {call.peerName || `User ${call.peerId}`}
          </p>
        </div>

        <span className="text-xs text-green-400">
          {remoteStream ? "Connected" : "Connecting..."}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {call.video ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={(event) => {
                event.currentTarget.play().catch((error) => {
                  console.error("Remote video playback error:", error);
                });
              }}
              className="h-full max-h-full w-full rounded-2xl bg-gray-900 object-contain"
            />

            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-6 right-6 h-32 w-24 rounded-xl border-2 border-white bg-gray-800 object-cover sm:h-44 sm:w-36"
            />
          </>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-lime-700 text-4xl font-bold">
              {(call.peerName || "U").charAt(0).toUpperCase()}
            </div>

            <audio ref={remoteAudioRef} autoPlay />
            <video ref={localVideoRef} autoPlay muted className="hidden" />

            <p className="text-lg font-semibold">
              {call.peerName || `User ${call.peerId}`}
            </p>
          </div>
        )}

        {call.video && <audio ref={remoteAudioRef} autoPlay />}
      </div>

      {callError && (
        <p className="px-4 pb-2 text-center text-sm text-red-400">
          {callError}
        </p>
      )}

      <div className="flex items-center justify-center gap-6 pb-10">
        <button
          onClick={toggleMute}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        >
          {muted ? <MicOff /> : <Mic />}
        </button>

        {call.video && (
          <button
            onClick={toggleCamera}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
            aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
          >
            {cameraOff ? <VideoOff /> : <Video />}
          </button>
        )}

        <button
          onClick={endCall}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700"
          aria-label="End call"
        >
          <PhoneOff />
        </button>
      </div>
    </div>
  );
}
