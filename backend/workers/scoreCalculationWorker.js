// backend/workers/scoreCalculationWorker.js
const { Worker } = require("bullmq");
const { getRedisClient } = require("../config/redis");
const redisService = require("../services/redisService");
const Quiz = require("../models/Quiz");

/**
 * Score Calculation Worker
 * Calculates scores based on correct answers and updates leaderboard
 */

const connection = getRedisClient();

const scoreCalculationWorker = new Worker(
    "scoreCalculation",
    async (job) => {
        const { quizId, questionId, studentId, selectedIndex } = job.data;

        console.log(`📊 Calculating score for student ${studentId} in quiz ${quizId}, question ${questionId}`);

        try {
            // Fetch quiz from database to get correct answer
            const quiz = await Quiz.findById(quizId);
            if (!quiz) {
                throw new Error(`Quiz ${quizId} not found`);
            }

            // Find the question
            const question = quiz.questions.find((q) => String(q._id) === String(questionId));
            if (!question) {
                throw new Error(`Question ${questionId} not found in quiz ${quizId}`);
            }

            // Check if answer is correct
            const isCorrect = question.correctAnswer === selectedIndex;
            const pointsEarned = isCorrect ? (question.points || 10) : 0;

            console.log(`Answer ${isCorrect ? "✓ correct" : "✗ incorrect"}, points: ${pointsEarned}`);

            // Get current score or initialize to 0
            const currentRank = await redisService.getStudentRank(quizId, studentId);
            const currentScore = currentRank.score || 0;
            const newScore = currentScore + pointsEarned;

            // Get student name from answer data
            const answer = await redisService.getStudentAnswer(quizId, questionId, studentId);
            const studentName = answer?.studentName || "Unknown";

            // Update leaderboard
            await redisService.updateLeaderboard(quizId, studentId, newScore, studentName);

            console.log(`Updated leaderboard for student ${studentId}: ${currentScore} → ${newScore}`);

            return {
                success: true,
                quizId,
                questionId,
                studentId,
                isCorrect,
                pointsEarned,
                newScore,
            };
        } catch (error) {
            console.error(`Error calculating score:`, error);
            throw error;
        }
    },
    {
        connection,
        concurrency: 20, // Process many score calculations concurrently
    }
);

scoreCalculationWorker.on("completed", (job, result) => {
    console.log(`✓ Score calculation job ${job.id} completed:`, result);
});

scoreCalculationWorker.on("failed", (job, err) => {
    console.error(`✗ Score calculation job ${job?.id} failed:`, err.message);
});

console.log("✓ Score Calculation Worker started");

module.exports = scoreCalculationWorker;
