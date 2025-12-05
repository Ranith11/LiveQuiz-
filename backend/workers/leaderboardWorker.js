// backend/workers/leaderboardWorker.js
const { Worker } = require("bullmq");
const { getRedisClient } = require("../config/redis");
const redisService = require("../services/redisService");

/**
 * Leaderboard Worker
 * Fetches and broadcasts leaderboard updates to quiz participants
 */

const connection = getRedisClient();

const leaderboardWorker = new Worker(
    "leaderboard",
    async (job) => {
        const { quizId, limit = 10 } = job.data;

        console.log(`🏆 Broadcasting leaderboard for quiz ${quizId}`);

        try {
            // Fetch leaderboard from Redis
            const leaderboard = await redisService.getLeaderboard(quizId, limit);

            // Broadcast to quiz room via Socket.IO
            const socketIo = require("../sockets").getIo();
            if (socketIo) {
                socketIo.to(quizId).emit("quiz:leaderboardUpdate", {
                    quizId,
                    leaderboard,
                    updatedAt: Date.now(),
                });

                console.log(`✓ Broadcasted leaderboard with ${leaderboard.length} entries`);
            } else {
                console.warn("Socket.IO not available for leaderboard broadcast");
            }

            return {
                success: true,
                quizId,
                leaderboardSize: leaderboard.length,
            };
        } catch (error) {
            console.error(`Error broadcasting leaderboard:`, error);
            throw error;
        }
    },
    {
        connection,
        concurrency: 15, // Handle multiple leaderboard updates concurrently
    }
);

leaderboardWorker.on("completed", (job, result) => {
    console.log(`✓ Leaderboard broadcast job ${job.id} completed`);
});

leaderboardWorker.on("failed", (job, err) => {
    console.error(`✗ Leaderboard broadcast job ${job?.id} failed:`, err.message);
});

console.log("✓ Leaderboard Worker started");

module.exports = leaderboardWorker;
