// backend/server.js
const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();

// Initialize database connection
require("./config/db")();

// Initialize Redis connection
const { getRedisClient, closeRedis } = require("./config/redis");
const redisClient = getRedisClient();

// Initialize BullMQ workers
const { initializeWorkers, shutdownWorkers } = require("./workers");
initializeWorkers();

app.use(cors());
app.use(express.json());

// Auth routes
app.use("/api/auth", require("./routes/authRoutes"));

// Quiz routes
app.use("/api/quiz", require("./routes/quizRoutes"));

// Create HTTP server for Socket.IO
const http = require("http");
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" }
});

// Load socket handler
const quizSocket = require("./sockets/quizSocket");
quizSocket(io);

// Initialize socket.io instance for workers
require('./sockets').init(io);

const PORT = process.env.PORT || 5000;

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log("HTTP server closed");

    // Shutdown workers
    await shutdownWorkers();

    // Close Redis connection
    await closeRedis();

    // Close database connection
    if (require("mongoose").connection) {
      await require("mongoose").connection.close();
      console.log("MongoDB connection closed");
    }

    console.log("Graceful shutdown complete");
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 10000);
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
server.listen(PORT, () => {
  console.log("========================================");
  console.log("🚀 LiveQuiz+ Server Started");
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🔗 Redis: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
  console.log("========================================");
});
