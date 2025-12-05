// backend/workers/questionTimerWorker.js
const { Worker } = require("bullmq");
const { getRedisClient } = require("../config/redis");
const redisService = require("../services/redisService");

/**
 * Question Timer Worker
 * Handles auto-advance to next question or quiz end when timer expires
 */

const connection = getRedisClient();

const questionTimerWorker = new Worker(
    "questionTimer",
    async (job) => {
        const { quizId, questionId, duration } = job.data;

        console.log(`⏱️  Processing question timer for quiz ${quizId}, question ${questionId}, duration ${duration}s`);

        // Wait for the specified duration
        await new Promise((resolve) => setTimeout(resolve, duration * 1000));

        // Get quiz state from Redis
        const activeQuestion = await redisService.getActiveQuestion(quizId);

        if (activeQuestion && activeQuestion.id === questionId) {
            console.log(`⏰ Timer expired for question ${questionId} in quiz ${quizId}`);

            // Emit socket event to notify clients (handled via server.js)
            const socketIo = require("../sockets").getIo();
            if (socketIo) {
                socketIo.to(quizId).emit("quiz:questionExpired", {
                    quizId,
                    questionId,
                });
            }

            // Clear respondents for next question
            await redisService.clearRespondents(quizId);
        }

        return { success: true, quizId, questionId };
    },
    {
        connection,
        concurrency: 10, // Process up to 10 timers concurrently
    }
);

questionTimerWorker.on("completed", (job) => {
    console.log(`✓ Question timer job ${job.id} completed`);
});

questionTimerWorker.on("failed", (job, err) => {
    console.error(`✗ Question timer job ${job?.id} failed:`, err.message);
});

console.log("✓ Question Timer Worker started");

module.exports = questionTimerWorker;
