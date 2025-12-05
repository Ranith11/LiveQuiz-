// backend/config/redis.js
const Redis = require("ioredis");

let redisClient = null;

/**
 * Get or create Redis client singleton
 */
function getRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const config = {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    };

    redisClient = new Redis(config);

    redisClient.on("connect", () => {
        console.log("✓ Redis connected successfully");
    });

    redisClient.on("error", (err) => {
        console.error("✗ Redis connection error:", err.message);
    });

    redisClient.on("reconnecting", () => {
        console.log("⟳ Redis reconnecting...");
    });

    return redisClient;
}

/**
 * Close Redis connection
 */
async function closeRedis() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        console.log("Redis connection closed");
    }
}

module.exports = {
    getRedisClient,
    closeRedis,
};
