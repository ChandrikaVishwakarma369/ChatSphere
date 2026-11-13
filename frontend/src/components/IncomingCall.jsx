import { Phone, PhoneOff, Video } from "lucide-react";
import { useCall } from "../context/CallContext";

export default function IncomingCall() {
  const { call, acceptCall, rejectCall } = useCall();

  if (!call || call.status !== "RINGING" || call.role !== "callee") {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-lime-100 text-lime-700">
          {call.video ? <Video size={35} /> : <Phone size={35} />}
        </div>

        <h2 className="mt-5 text-xl font-bold text-gray-800">
          Incoming {call.video ? "Video" : "Audio"} Call
        </h2>

        <p className="mt-2 text-sm text-gray-500">User ID: {call.peerId}</p>

        <div className="mt-7 flex justify-center gap-6">
          <button
            onClick={rejectCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
            aria-label="Reject call"
          >
            <PhoneOff />
          </button>

          <button
            onClick={acceptCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600"
            aria-label="Accept call"
          >
            <Phone />
          </button>
        </div>
      </div>
    </div>
  );
}
