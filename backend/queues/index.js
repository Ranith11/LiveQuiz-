// backend/queues/index.js
const { Queue } = require("bullmq");
const { getRedisClient } = require("../config/redis");

/**
 * BullMQ Queue Manager
 * Defines and exports all queues used in the application
 */

// Get Redis connection for BullMQ
const connection = getRedisClient();

// Question Timer Queue - Handle question timers and auto-advance
const questionTimerQueue = new Queue("questionTimer", {
    connection,
    defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
    },
});

// Score Calculation Queue - Calculate scores after answers
const scoreCalculationQueue = new Queue("scoreCalculation", {
    connection,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
    },
});

// Leaderboard Update Queue - Broadcast leaderboard updates
const leaderboardQueue = new Queue("leaderboard", {
    connection,
    defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 200,
        attempts: 2,
        backoff: {
            type: "fixed",
            delay: 500,
        },
    },
});

// Cleanup Queue - Remove old quiz data
const cleanupQueue = new Queue("cleanup", {
    connection,
    defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 100,
        attempts: 2,
        backoff: {
            type: "fixed",
            delay: 5000,
        },
    },
});

// Log queue events for monitoring
[questionTimerQueue, scoreCalculationQueue, leaderboardQueue, cleanupQueue].forEach((queue) => {
    queue.on("error", (err) => {
        console.error(`Queue ${queue.name} error:`, err.message);
    });

    queue.on("waiting", (jobId) => {
        console.log(`Job ${jobId} waiting in queue ${queue.name}`);
    });
});

console.log("✓ BullMQ queues initialized");

module.exports = {
    questionTimerQueue,
    scoreCalculationQueue,
    leaderboardQueue,
    cleanupQueue,
};
