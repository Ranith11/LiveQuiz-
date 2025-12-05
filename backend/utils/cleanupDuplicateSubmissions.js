// backend/utils/cleanupDuplicateSubmissions.js
/**
 * Utility script to clean up duplicate submissions in existing quizzes
 * Run this once to fix legacy data: node utils/cleanupDuplicateSubmissions.js
 */

const mongoose = require("mongoose");
const Quiz = require("../models/Quiz");
require("dotenv").config();

async function cleanupDuplicates() {
    try {
        // Connect to MongoDB
        const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/livequiz";
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB");

        // Find all quizzes with submissions
        const quizzes = await Quiz.find({ "submissions.0": { $exists: true } });
        console.log(`Found ${quizzes.length} quizzes with submissions`);

        let totalFixed = 0;

        for (const quiz of quizzes) {
            const originalCount = quiz.submissions.length;

            // Deduplicate submissions
            const studentMap = new Map();
            const uniqueSubmissions = [];

            quiz.submissions.forEach(sub => {
                const studentKey = sub.studentId || sub.studentName || "anonymous";

                if (!studentMap.has(studentKey)) {
                    studentMap.set(studentKey, true);
                    uniqueSubmissions.push(sub);
                } else {
                    // Found duplicate - merge answers
                    const existing = uniqueSubmissions.find(s =>
                        (s.studentId && s.studentId === sub.studentId) ||
                        (s.studentName === sub.studentName)
                    );

                    if (existing) {
                        // Merge answers from duplicate into existing
                        sub.answers.forEach(ans => {
                            const hasAnswer = existing.answers.some(a =>
                                String(a.questionId) === String(ans.questionId)
                            );

                            if (!hasAnswer) {
                                existing.answers.push(ans);
                            }
                        });

                        // Update timestamp to latest
                        if (new Date(sub.submittedAt) > new Date(existing.submittedAt)) {
                            existing.submittedAt = sub.submittedAt;
                        }
                    }
                }
            });

            if (uniqueSubmissions.length < originalCount) {
                quiz.submissions = uniqueSubmissions;
                await quiz.save();

                const duplicatesRemoved = originalCount - uniqueSubmissions.length;
                console.log(`Quiz ${quiz._id}: Removed ${duplicatesRemoved} duplicate(s)`);
                totalFixed++;
            }
        }

        console.log(`\n✓ Cleanup complete! Fixed ${totalFixed} quizzes`);

    } catch (error) {
        console.error("Error during cleanup:", error);
    } finally {
        await mongoose.connection.close();
        console.log("MongoDB connection closed");
    }
}

// Run if executed directly
if (require.main === module) {
    cleanupDuplicates();
}

module.exports = cleanupDuplicates;
