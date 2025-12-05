// backend/services/redisService.js
const { getRedisClient } = require("../config/redis");

/**
 * Redis Service for Quiz Data Management
 * Handles quiz rooms, questions, answers, and leaderboard
 */

const QUIZ_ROOM_KEY = (quizId) => `quiz:${quizId}:room`;
const QUIZ_QUESTION_KEY = (quizId) => `quiz:${quizId}:question`;
const QUIZ_ANSWERS_KEY = (quizId, questionId) => `quiz:${quizId}:answers:${questionId}`;
const QUIZ_LEADERBOARD_KEY = (quizId) => `quiz:${quizId}:leaderboard`;
const QUIZ_PARTICIPANTS_KEY = (quizId) => `quiz:${quizId}:participants`;
const QUIZ_COUNTS_KEY = (quizId) => `quiz:${quizId}:counts`;
const QUIZ_RESPONDENTS_KEY = (quizId) => `quiz:${quizId}:respondents`;
const QUIZ_QUESTIONS_LIST_KEY = (quizId) => `quiz:${quizId}:questionsList`;

class RedisService {
    constructor() {
        this.redis = getRedisClient();
    }

    // ==================== Quiz Room Management ====================

    /**
     * Create or update quiz room
     */
    async createQuizRoom(quizId, roomData) {
        const key = QUIZ_ROOM_KEY(quizId);
        const data = {
            quizId,
            createdAt: Date.now(),
            ...roomData,
        };
        await this.redis.hset(key, data);
        // Set expiry for 24 hours
        await this.redis.expire(key, 86400);
        return data;
    }

    /**
     * Get quiz room data
     */
    async getQuizRoom(quizId) {
        const key = QUIZ_ROOM_KEY(quizId);
        const data = await this.redis.hgetall(key);
        return Object.keys(data).length > 0 ? data : null;
    }

    /**
     * Delete quiz room
     */
    async deleteQuizRoom(quizId) {
        const keys = await this.redis.keys(`quiz:${quizId}:*`);
        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
    }

    // ==================== Participants Management ====================

    /**
     * Add participant to quiz
     */
    async addParticipant(quizId, participantData) {
        const key = QUIZ_PARTICIPANTS_KEY(quizId);
        const { socketId, username, role, userId } = participantData;
        await this.redis.hset(key, socketId, JSON.stringify({ username, role, userId, joinedAt: Date.now() }));
        await this.redis.expire(key, 86400);
    }

    /**
     * Remove participant from quiz
     */
    async removeParticipant(quizId, socketId) {
        const key = QUIZ_PARTICIPANTS_KEY(quizId);
        await this.redis.hdel(key, socketId);
    }

    /**
     * Get all participants
     */
    async getParticipants(quizId) {
        const key = QUIZ_PARTICIPANTS_KEY(quizId);
        const data = await this.redis.hgetall(key);
        const participants = {};
        for (const [socketId, value] of Object.entries(data)) {
            participants[socketId] = JSON.parse(value);
        }
        return participants;
    }

    // ==================== Active Question Management ====================

    /**
     * Set current active question
     */
    async setActiveQuestion(quizId, questionData) {
        const key = QUIZ_QUESTION_KEY(quizId);
        await this.redis.set(key, JSON.stringify(questionData));
        await this.redis.expire(key, 86400);
    }

    /**
     * Get current active question
     */
    async getActiveQuestion(quizId) {
        const key = QUIZ_QUESTION_KEY(quizId);
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
    }

    /**
     * Clear active question
     */
    async clearActiveQuestion(quizId) {
        const key = QUIZ_QUESTION_KEY(quizId);
        await this.redis.del(key);
    }

    // ==================== Questions List Management ====================

    /**
     * Store full questions list
     */
    async setQuestionsList(quizId, questions) {
        const key = QUIZ_QUESTIONS_LIST_KEY(quizId);
        await this.redis.set(key, JSON.stringify(questions));
        await this.redis.expire(key, 86400);
    }

    /**
     * Get full questions list
     */
    async getQuestionsList(quizId) {
        const key = QUIZ_QUESTIONS_LIST_KEY(quizId);
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
    }

    // ==================== Answer Counts Management ====================

    /**
     * Initialize answer counts for a question
     */
    async initializeCounts(quizId, optionsCount) {
        const key = QUIZ_COUNTS_KEY(quizId);
        const counts = Array(optionsCount).fill(0);
        await this.redis.set(key, JSON.stringify(counts));
        await this.redis.expire(key, 86400);
        return counts;
    }

    /**
     * Get answer counts
     */
    async getCounts(quizId) {
        const key = QUIZ_COUNTS_KEY(quizId);
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : [];
    }

    /**
     * Update answer counts
     */
    async updateCounts(quizId, counts) {
        const key = QUIZ_COUNTS_KEY(quizId);
        await this.redis.set(key, JSON.stringify(counts));
        await this.redis.expire(key, 86400);
    }

    // ==================== Respondents Management ====================

    /**
     * Check if socket has already responded
     */
    async hasResponded(quizId, socketId) {
        const key = QUIZ_RESPONDENTS_KEY(quizId);
        const result = await this.redis.hexists(key, socketId);
        return result === 1;
    }

    /**
     * Record respondent's answer
     */
    async recordRespondent(quizId, socketId, selectedIndex) {
        const key = QUIZ_RESPONDENTS_KEY(quizId);
        await this.redis.hset(key, socketId, selectedIndex);
        await this.redis.expire(key, 86400);
    }

    /**
     * Get respondent's answer
     */
    async getRespondentAnswer(quizId, socketId) {
        const key = QUIZ_RESPONDENTS_KEY(quizId);
        const answer = await this.redis.hget(key, socketId);
        return answer !== null ? parseInt(answer) : null;
    }

    /**
     * Remove respondent
     */
    async removeRespondent(quizId, socketId) {
        const key = QUIZ_RESPONDENTS_KEY(quizId);
        await this.redis.hdel(key, socketId);
    }

    /**
     * Clear all respondents
     */
    async clearRespondents(quizId) {
        const key = QUIZ_RESPONDENTS_KEY(quizId);
        await this.redis.del(key);
    }

    // ==================== Student Answers Management ====================

    /**
     * Store student answer for a specific question
     */
    async storeAnswer(quizId, questionId, studentId, studentName, selectedIndex) {
        const key = QUIZ_ANSWERS_KEY(quizId, questionId);
        const answerData = {
            studentId,
            studentName,
            selectedIndex,
            answeredAt: Date.now(),
        };
        await this.redis.hset(key, studentId, JSON.stringify(answerData));
        await this.redis.expire(key, 86400);
    }

    /**
     * Get all answers for a question
     */
    async getAnswersForQuestion(quizId, questionId) {
        const key = QUIZ_ANSWERS_KEY(quizId, questionId);
        const data = await this.redis.hgetall(key);
        const answers = {};
        for (const [studentId, value] of Object.entries(data)) {
            answers[studentId] = JSON.parse(value);
        }
        return answers;
    }

    /**
     * Get student's answer for a question
     */
    async getStudentAnswer(quizId, questionId, studentId) {
        const key = QUIZ_ANSWERS_KEY(quizId, questionId);
        const answer = await this.redis.hget(key, studentId);
        return answer ? JSON.parse(answer) : null;
    }

    // ==================== Leaderboard Management ====================

    /**
     * Update student score in leaderboard
     */
    async updateLeaderboard(quizId, studentId, score, studentName = null) {
        const key = QUIZ_LEADERBOARD_KEY(quizId);
        await this.redis.zadd(key, score, studentId);

        // Store student name mapping if provided
        if (studentName) {
            await this.redis.hset(`${key}:names`, studentId, studentName);
        }

        await this.redis.expire(key, 86400);
        await this.redis.expire(`${key}:names`, 86400);
    }

    /**
     * Get leaderboard (top N students)
     */
    async getLeaderboard(quizId, limit = 10) {
        const key = QUIZ_LEADERBOARD_KEY(quizId);
        const namesKey = `${key}:names`;

        // Get top scores in descending order
        const results = await this.redis.zrevrange(key, 0, limit - 1, "WITHSCORES");
        const names = await this.redis.hgetall(namesKey);

        const leaderboard = [];
        for (let i = 0; i < results.length; i += 2) {
            const studentId = results[i];
            const score = parseInt(results[i + 1]);
            leaderboard.push({
                rank: Math.floor(i / 2) + 1,
                studentId,
                studentName: names[studentId] || "Unknown",
                score,
            });
        }

        return leaderboard;
    }

    /**
     * Get student rank and score
     */
    async getStudentRank(quizId, studentId) {
        const key = QUIZ_LEADERBOARD_KEY(quizId);
        const score = await this.redis.zscore(key, studentId);
        const rank = await this.redis.zrevrank(key, studentId);

        return {
            score: score ? parseInt(score) : 0,
            rank: rank !== null ? rank + 1 : null,
        };
    }

    // ==================== Cleanup ====================

    /**
     * Get all quiz keys for cleanup
     */
    async getAllQuizKeys(quizId) {
        return await this.redis.keys(`quiz:${quizId}:*`);
    }

    /**
     * Clean up old quiz data
     */
    async cleanupQuiz(quizId) {
        const keys = await this.getAllQuizKeys(quizId);
        if (keys.length > 0) {
            await this.redis.del(...keys);
            console.log(`Cleaned up ${keys.length} keys for quiz ${quizId}`);
        }
    }

    /**
     * Get all quiz IDs from Redis
     */
    async getAllQuizIds() {
        const keys = await this.redis.keys("quiz:*:room");
        return keys.map((key) => key.split(":")[1]);
    }
}

module.exports = new RedisService();
