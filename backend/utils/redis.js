const { createClient } = require('redis');

let redisClient = null;

/**
 * Initialize Redis connection
 */
async function initializeRedis() {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          console.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          console.error('Redis max retry attempts reached');
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis ready for operations');
    });

    await redisClient.connect();
    
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
}

/**
 * Get Redis client
 */
function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis not initialized');
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('✅ Redis connection closed');
  }
}

/**
 * Cache nonce with TTL
 */
async function cacheNonce(nonce, merchant_id, ttl = 300) {
  try {
    const redis = getRedisClient();
    const key = `nonce:${nonce}`;
    const timestampKey = `nonce_timestamp:${nonce}`;
    
    await redis.setex(key, ttl, 'pending');
    await redis.setex(timestampKey, ttl, Date.now().toString());
    
    return true;
  } catch (error) {
    console.error('Error caching nonce:', error);
    return false;
  }
}

/**
 * Get cached nonce status
 */
async function getNonceStatus(nonce) {
  try {
    const redis = getRedisClient();
    const status = await redis.get(`nonce:${nonce}`);
    return status;
  } catch (error) {
    console.error('Error getting nonce status:', error);
    return null;
  }
}

/**
 * Store fraud metrics
 */
async function storeFraudMetrics(merchant_id, metrics) {
  try {
    const redis = getRedisClient();
    const key = `fraud_metrics:${merchant_id}`;
    
    await redis.hmset(key, metrics);
    await redis.expire(key, 86400); // 24 hours
    
    return true;
  } catch (error) {
    console.error('Error storing fraud metrics:', error);
    return false;
  }
}

/**
 * Get fraud metrics
 */
async function getFraudMetrics(merchant_id) {
  try {
    const redis = getRedisClient();
    const key = `fraud_metrics:${merchant_id}`;
    
    const metrics = await redis.hgetall(key);
    return metrics;
  } catch (error) {
    console.error('Error getting fraud metrics:', error);
    return {};
  }
}

/**
 * Store real-time analytics data
 */
async function storeAnalyticsData(data) {
  try {
    const redis = getRedisClient();
    const key = `analytics:${Date.now()}`;
    
    await redis.setex(key, 3600, JSON.stringify(data)); // 1 hour TTL
    
    return true;
  } catch (error) {
    console.error('Error storing analytics data:', error);
    return false;
  }
}

module.exports = {
  initializeRedis,
  getRedisClient,
  closeRedis,
  cacheNonce,
  getNonceStatus,
  storeFraudMetrics,
  getFraudMetrics,
  storeAnalyticsData
};
