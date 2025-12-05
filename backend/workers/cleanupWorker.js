// backend/workers/cleanupWorker.js
const { Worker } = require("bullmq");
const { getRedisClient } = require("../config/redis");
const redisService = require("../services/redisService");
const Quiz = require("../models/Quiz");

/**
 * Cleanup Worker
 * Removes old quiz data from Redis after quiz completion
 */

const connection = getRedisClient();

const cleanupWorker = new Worker(
    "cleanup",
    async (job) => {
        const { quizId, delay = 0 } = job.data;

        console.log(`🧹 Cleanup job for quiz ${quizId} (delay: ${delay}s)`);

        // Wait for delay if specified
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }

        try {
            // Check if quiz exists and is completed
            const quiz = await Quiz.findById(quizId);
            if (quiz && quiz.status === "completed") {
                // Remove all quiz data from Redis
                await redisService.cleanupQuiz(quizId);

                console.log(`✓ Cleaned up Redis data for completed quiz ${quizId}`);

                return {
                    success: true,
                    quizId,
                    status: "completed",
                };
            } else {
                console.log(`Quiz ${quizId} is not completed yet, skipping cleanup`);
                return {
                    success: false,
                    quizId,
                    reason: "Quiz not completed",
                };
            }
        } catch (error) {
            console.error(`Error during cleanup:`, error);
            throw error;
        }
    },
    {
        connection,
        concurrency: 5, // Lower concurrency for cleanup tasks
    }
);

cleanupWorker.on("completed", (job, result) => {
    console.log(`✓ Cleanup job ${job.id} completed:`, result);
});

cleanupWorker.on("failed", (job, err) => {
    console.error(`✗ Cleanup job ${job?.id} failed:`, err.message);
});

console.log("✓ Cleanup Worker started");

module.exports = cleanupWorker;
