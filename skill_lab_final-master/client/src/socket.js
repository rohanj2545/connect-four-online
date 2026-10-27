import { io } from "socket.io-client";

// The backend server URL (defaults to current host at port 3000)
const defaultServerUrl =
  typeof window !== "undefined" && window.location.hostname
    ? `http://${window.location.hostname}:3000`
    : "http://localhost:3000";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || defaultServerUrl;

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});
