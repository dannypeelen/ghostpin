const crypto = require('crypto');
const { getRedisClient } = require('../utils/redis');
const { getDatabaseClient } = require('../utils/database');

/**
 * Verify cryptographic signature using WebAuthn or custom signing
 */
async function verifySignature({ merchant_id, origin, nonce, payment_intent, timestamp, signature }) {
  try {
    // Get merchant's public key
    const merchantKey = await getMerchantPublicKey(merchant_id);
    if (!merchantKey) {
      return { valid: false, reason: 'Merchant not found or no public key registered' };
    }

    // Create payload for verification
    const payload = {
      merchant_id,
      origin,
      nonce,
      payment_intent,
      timestamp
    };

    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    const payloadHash = crypto.createHash('sha256').update(payloadString).digest();

    // Verify signature
    const verifier = crypto.createVerify('sha256');
    verifier.update(payloadHash);
    
    const isValid = verifier.verify(merchantKey, signature, 'base64');
    
    if (!isValid) {
      return { valid: false, reason: 'Signature verification failed' };
    }

    return { valid: true, reason: 'Signature valid' };
  } catch (error) {
    console.error('Signature verification error:', error);
    return { valid: false, reason: 'Signature verification error' };
  }
}

/**
 * Validate nonce to prevent replay attacks
 */
async function validateNonce(nonce, merchant_id) {
  try {
    const redis = getRedisClient();
    
    // Check if nonce has been used
    const used = await redis.get(`nonce:${nonce}`);
    if (used) {
      return false;
    }

    // Validate nonce format (should be SHA256 hash)
    if (!/^[a-f0-9]{64}$/.test(nonce)) {
      return false;
    }

    // Check nonce age (should be recent)
    const nonceTimestamp = await redis.get(`nonce_timestamp:${nonce}`);
    if (nonceTimestamp) {
      const age = Date.now() - parseInt(nonceTimestamp);
      if (age > 300000) { // 5 minutes
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Nonce validation error:', error);
    return false;
  }
}

/**
 * Get merchant's public key for signature verification
 */
async function getMerchantPublicKey(merchant_id) {
  try {
    const db = getDatabaseClient();
    const result = await db.query(
      'SELECT public_key FROM merchants WHERE merchant_id = $1 AND active = true',
      [merchant_id]
    );
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].public_key;
  } catch (error) {
    console.error('Error fetching merchant key:', error);
    return null;
  }
}

/**
 * Log verification attempt for analytics and fraud detection
 */
async function logVerification({
  merchant_id,
  origin,
  nonce,
  verified,
  reason,
  attestation_score = null,
  ip_address,
  user_agent
}) {
  try {
    const db = getDatabaseClient();
    
    await db.query(`
      INSERT INTO verification_logs (
        merchant_id, origin, nonce, verified, reason, 
        attestation_score, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      merchant_id,
      origin,
      nonce,
      verified,
      reason,
      attestation_score,
      ip_address,
      user_agent
    ]);

    // Update fraud metrics
    await updateFraudMetrics(merchant_id, verified, reason);
    
  } catch (error) {
    console.error('Error logging verification:', error);
  }
}

/**
 * Update fraud detection metrics
 */
async function updateFraudMetrics(merchant_id, verified, reason) {
  try {
    const redis = getRedisClient();
    const key = `fraud_metrics:${merchant_id}`;
    
    // Increment counters
    await redis.hincrby(key, 'total_attempts', 1);
    
    if (verified) {
      await redis.hincrby(key, 'successful_verifications', 1);
    } else {
      await redis.hincrby(key, 'failed_verifications', 1);
      
      // Track specific failure reasons
      const reasonKey = `fraud_reasons:${merchant_id}`;
      await redis.hincrby(reasonKey, reason, 1);
      await redis.expire(reasonKey, 86400); // 24 hours
    }
    
    // Set expiration for metrics
    await redis.expire(key, 86400); // 24 hours
    
  } catch (error) {
    console.error('Error updating fraud metrics:', error);
  }
}

/**
 * Generate a secure nonce for the client
 */
function generateNonce(merchant_id, timestamp, intent, random) {
  const data = `${merchant_id}:${timestamp}:${JSON.stringify(intent)}:${random}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Validate payment intent structure
 */
function validatePaymentIntent(payment_intent) {
  if (!payment_intent || typeof payment_intent !== 'object') {
    return false;
  }
  
  const required = ['amount', 'currency'];
  return required.every(field => payment_intent.hasOwnProperty(field));
}

module.exports = {
  verifySignature,
  validateNonce,
  logVerification,
  generateNonce,
  validatePaymentIntent,
  updateFraudMetrics
};
