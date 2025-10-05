const { v4: uuidv4 } = require('uuid');
const { getRedisClient } = require('../utils/redis');

const IN_MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const inMemoryStore = new Map();

function generateDemoToken() {
  return uuidv4();
}

async function persistSecret(token, payload, ttlSeconds) {
  try {
    const redis = getRedisClient();
    const key = buildRedisKey(token);
    await redis.set(key, JSON.stringify(payload), { EX: ttlSeconds });
    return true;
  } catch (error) {
    if (error.message !== 'Redis not initialized') {
      console.error('Failed to write demo MFA secret to Redis:', error);
    }

    inMemoryStore.set(token, {
      ...payload,
      expiresAt: Date.now() + IN_MEMORY_TTL_MS
    });
    return true;
  }
}

async function loadSecret(token) {
  try {
    const redis = getRedisClient();
    const key = buildRedisKey(token);
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    if (error.message !== 'Redis not initialized') {
      console.error('Failed to read demo MFA secret from Redis:', error);
    }

    const entry = inMemoryStore.get(token);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      inMemoryStore.delete(token);
      return null;
    }

    return entry;
  }
}

async function removeSecret(token) {
  let removed = false;

  try {
    const redis = getRedisClient();
    const key = buildRedisKey(token);
    const result = await redis.del(key);
    removed = removed || result === 1;
  } catch (error) {
    if (error.message !== 'Redis not initialized') {
      console.error('Failed to remove demo MFA secret from Redis:', error);
    }
  }

  if (inMemoryStore.delete(token)) {
    removed = true;
  }

  return removed;
}

function buildRedisKey(token) {
  return `demo:mfa:${token}`;
}

module.exports = {
  generateDemoToken,
  persistSecret,
  loadSecret,
  removeSecret
};
