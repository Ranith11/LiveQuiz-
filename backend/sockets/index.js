// backend/sockets/index.js
// tiny helper to store and retrieve the socket.io instance
let ioInstance = null;

module.exports = {
  init(io) {
    ioInstance = io;
    return ioInstance;
  },
  getIo() {
    if (!ioInstance) {
      console.warn("Socket IO not initialized yet (getIo called early)");
    }
    return ioInstance;
  }
};
