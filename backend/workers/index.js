// backend/workers/index.js
/**
 * Worker Initialization Module
 * Starts all BullMQ workers for background task processing
 */

const questionTimerWorker = require("./questionTimerWorker");
const scoreCalculationWorker = require("./scoreCalculationWorker");
const leaderboardWorker = require("./leaderboardWorker");
const cleanupWorker = require("./cleanupWorker");

/**
 * Initialize all workers
 */
function initializeWorkers() {
    console.log("🚀 Initializing all BullMQ workers...");

    // Workers are automatically started when required
    // This function serves as a central initialization point

    return {
        questionTimerWorker,
        scoreCalculationWorker,
        leaderboardWorker,
        cleanupWorker,
    };
}

/**
 * Gracefully shutdown all workers
 */
async function shutdownWorkers() {
    console.log("Shutting down workers...");

    try {
        await Promise.all([
            questionTimerWorker.close(),
            scoreCalculationWorker.close(),
            leaderboardWorker.close(),
            cleanupWorker.close(),
        ]);

        console.log("✓ All workers shut down successfully");
    } catch (error) {
        console.error("Error shutting down workers:", error);
    }
}

module.exports = {
    initializeWorkers,
    shutdownWorkers,
    questionTimerWorker,
    scoreCalculationWorker,
    leaderboardWorker,
    cleanupWorker,
};
