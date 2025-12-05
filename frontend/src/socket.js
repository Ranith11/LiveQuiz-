// frontend/src/socket.js
import { io } from "socket.io-client";

const BASE = process.env.REACT_APP_WS_URL || process.env.REACT_APP_API_URL || "http://localhost:5000";

// create a single shared socket instance and let it auto-connect once
const socket = io(BASE, {
  autoConnect: true,        // connect immediately (persistent)
  transports: ["websocket"],
  // auth: { token: localStorage.getItem("token") } // optional
});

export default socket;
