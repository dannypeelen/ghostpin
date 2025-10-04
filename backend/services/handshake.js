const crypto = require('crypto');
const { getDatabaseClient } = require('../utils/database');
const { getRedisClient } = require('../utils/redis');

/**
 * Verify complete two-way handshake
 */
async function verifyHandshake(handshakeProof) {
  try {
    // Step 1: Validate handshake structure
    if (!handshakeProof.merchant_challenge || !handshakeProof.user_response) {
      return { valid: false, reason: 'Invalid handshake structure' };
    }

    // Step 2: Verify merchant challenge
    const merchantValid = await verifyMerchantChallenge(handshakeProof.merchant_challenge);
    if (!merchantValid.valid) {
      return { valid: false, reason: merchantValid.reason };
    }

    // Step 3: Verify user response
    const userValid = await verifyUserResponse(handshakeProof.user_response);
    if (!userValid.valid) {
      return { valid: false, reason: userValid.reason };
    }

    // Step 4: Verify mutual proof
    const mutualValid = await verifyMutualProof(handshakeProof);
    if (!mutualValid.valid) {
      return { valid: false, reason: mutualValid.reason };
    }

    return { valid: true, reason: 'Handshake verification successful' };

  } catch (error) {
    console.error('Handshake verification error:', error);
    return { valid: false, reason: 'Handshake verification error' };
  }
}

/**
 * Validate mutual proof
 */
async function validateMutualProof(handshakeProof) {
  try {
    const { merchant_challenge, user_response, mutual_signature } = handshakeProof;

    // Verify mutual signature
    const expectedSignature = await generateExpectedMutualSignature(merchant_challenge, user_response);
    if (mutual_signature !== expectedSignature) {
      return { valid: false, reason: 'Mutual signature mismatch' };
    }

    // Verify handshake ID uniqueness
    const handshakeId = handshakeProof.handshake_id;
    const redis = getRedisClient();
    const existingHandshake = await redis.get(`handshake:${handshakeId}`);
    if (existingHandshake) {
      return { valid: false, reason: 'Handshake ID already used' };
    }

    // Mark handshake as used
    await redis.setex(`handshake:${handshakeId}`, 300, 'used'); // 5 minutes TTL

    return { valid: true, reason: 'Mutual proof valid' };

  } catch (error) {
    console.error('Mutual proof validation error:', error);
    return { valid: false, reason: 'Mutual proof validation error' };
  }
}

/**
 * Detect fraud patterns
 */
async function detectFraudPatterns(data) {
  try {
    const { merchant_id, origin, handshake_proof, ip_address, user_agent } = data;
    
    let riskScore = 0;
    const indicators = [];

    // Check merchant registration
    const merchant = await getMerchantInfo(merchant_id);
    if (!merchant) {
      riskScore += 0.4;
      indicators.push('Unregistered merchant');
    }

    // Check domain spoofing
    if (await isDomainSpoofing(origin)) {
      riskScore += 0.3;
      indicators.push('Domain spoofing detected');
    }

    // Check suspicious patterns
    if (await isSuspiciousPattern(origin)) {
      riskScore += 0.2;
      indicators.push('Suspicious domain pattern');
    }

    // Check timing anomalies
    if (await isTimingAnomaly(handshake_proof)) {
      riskScore += 0.1;
      indicators.push('Timing anomaly detected');
    }

    // Check device anomalies
    if (await isDeviceAnomaly(user_agent)) {
      riskScore += 0.1;
      indicators.push('Device anomaly detected');
    }

    // Check IP reputation
    if (await isSuspiciousIP(ip_address)) {
      riskScore += 0.2;
      indicators.push('Suspicious IP address');
    }

    return {
      risk_score: Math.min(1, riskScore),
      indicators: indicators,
      fraud_detected: riskScore > 0.5
    };

  } catch (error) {
    console.error('Fraud detection error:', error);
    return {
      risk_score: 0.5, // Default to medium risk on error
      indicators: ['Fraud detection error'],
      fraud_detected: true
    };
  }
}

/**
 * Verify merchant challenge
 */
async function verifyMerchantChallenge(merchantChallenge) {
  try {
    // Verify timestamp freshness
    const age = Date.now() - merchantChallenge.timestamp;
    if (age > 300000) { // 5 minutes
      return { valid: false, reason: 'Merchant challenge too old' };
    }

    // Verify visual nonce format
    if (!merchantChallenge.visual_nonce || !/^[a-f0-9]{64}$/.test(merchantChallenge.visual_nonce)) {
      return { valid: false, reason: 'Invalid visual nonce format' };
    }

    // Verify domain proof
    const expectedDomainProof = await generateExpectedDomainProof(merchantChallenge.merchant_id);
    if (merchantChallenge.domain_proof !== expectedDomainProof) {
      return { valid: false, reason: 'Domain proof mismatch' };
    }

    return { valid: true, reason: 'Merchant challenge valid' };

  } catch (error) {
    console.error('Merchant challenge verification error:', error);
    return { valid: false, reason: 'Merchant challenge verification error' };
  }
}

/**
 * Verify user response
 */
async function verifyUserResponse(userResponse) {
  try {
    // Verify WebAuthn credential
    if (!userResponse.credential || !userResponse.credential.id) {
      return { valid: false, reason: 'Missing WebAuthn credential' };
    }

    // Verify user proof
    if (!userResponse.user_proof || typeof userResponse.user_proof !== 'string') {
      return { valid: false, reason: 'Invalid user proof' };
    }

    // Verify device binding
    if (!userResponse.device_binding || typeof userResponse.device_binding !== 'string') {
      return { valid: false, reason: 'Invalid device binding' };
    }

    return { valid: true, reason: 'User response valid' };

  } catch (error) {
    console.error('User response verification error:', error);
    return { valid: false, reason: 'User response verification error' };
  }
}

/**
 * Verify mutual proof
 */
async function verifyMutualProof(handshakeProof) {
  try {
    const { merchant_challenge, user_response, mutual_signature } = handshakeProof;

    // Verify mutual signature
    const expectedSignature = await generateExpectedMutualSignature(merchant_challenge, user_response);
    if (mutual_signature !== expectedSignature) {
      return { valid: false, reason: 'Mutual signature mismatch' };
    }

    return { valid: true, reason: 'Mutual proof valid' };

  } catch (error) {
    console.error('Mutual proof verification error:', error);
    return { valid: false, reason: 'Mutual proof verification error' };
  }
}

/**
 * Generate expected domain proof
 */
async function generateExpectedDomainProof(merchantId) {
  const expectedOrigin = process.env[`MERCHANT_${merchantId.toUpperCase()}_ORIGIN`];
  if (!expectedOrigin) {
    throw new Error('Merchant origin not configured');
  }

  const domainData = {
    domain: new URL(expectedOrigin).hostname,
    protocol: new URL(expectedOrigin).protocol,
    timestamp: Date.now()
  };

  return crypto.createHash('sha256').update(JSON.stringify(domainData)).digest('hex');
}

/**
 * Generate expected mutual signature
 */
async function generateExpectedMutualSignature(merchantChallenge, userResponse) {
  const proofData = {
    merchant_challenge: merchantChallenge,
    user_response: userResponse,
    timestamp: Date.now()
  };

  const proofString = JSON.stringify(proofData);
  const proofHash = crypto.createHash('sha256').update(proofString).digest('hex');
  
  return crypto.createHash('sha256').update(proofHash + merchantChallenge.merchant_id).digest('hex');
}

/**
 * Get merchant information
 */
async function getMerchantInfo(merchantId) {
  try {
    const db = getDatabaseClient();
    const result = await db.query(
      'SELECT * FROM merchants WHERE merchant_id = $1 AND active = true',
      [merchantId]
    );
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching merchant info:', error);
    return null;
  }
}

/**
 * Check for domain spoofing
 */
async function isDomainSpoofing(origin) {
  const suspiciousPatterns = [
    /paypal-security/i,
    /amazon-payments/i,
    /stripe-verify/i,
    /apple-pay-secure/i,
    /bank-login/i,
    /security-center/i
  ];

  return suspiciousPatterns.some(pattern => pattern.test(origin));
}

/**
 * Check for suspicious patterns
 */
async function isSuspiciousPattern(origin) {
  const suspiciousIndicators = [
    /[0-9]+/, // Contains numbers
    /-/, // Contains hyphens
    /\.(tk|ml|ga|cf)$/i, // Suspicious TLDs
    /bit\.ly|tinyurl|goo\.gl/i // URL shorteners
  ];

  return suspiciousIndicators.some(pattern => pattern.test(origin));
}

/**
 * Check for timing anomalies
 */
async function isTimingAnomaly(handshakeProof) {
  const startTime = handshakeProof.merchant_challenge?.timestamp || 0;
  const endTime = handshakeProof.timestamp || 0;
  const duration = endTime - startTime;

  // Too fast (bot) or too slow (manual tampering)
  return duration < 1000 || duration > 300000; // 1 second to 5 minutes
}

/**
 * Check for device anomalies
 */
async function isDeviceAnomaly(userAgent) {
  const suspiciousPatterns = [
    /bot|crawler|spider/i,
    /headless/i,
    /phantom|selenium/i,
    /curl|wget/i
  ];

  return suspiciousPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Check for suspicious IP
 */
async function isSuspiciousIP(ipAddress) {
  // Simple IP reputation check
  const suspiciousIPs = [
    '127.0.0.1', // Localhost
    '0.0.0.0',   // Invalid
    '255.255.255.255' // Broadcast
  ];

  return suspiciousIPs.includes(ipAddress);
}

/**
 * Log handshake attempt
 */
async function logHandshakeAttempt(data) {
  try {
    const db = getDatabaseClient();
    
    await db.query(`
      INSERT INTO handshake_logs (
        merchant_id, origin, handshake_id, verified, reason, 
        risk_score, fraud_indicators, step, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      data.merchant_id,
      data.origin,
      data.handshake_id,
      data.verified,
      data.reason,
      data.risk_score || 0,
      JSON.stringify(data.fraud_indicators || []),
      data.step,
      data.ip_address,
      data.user_agent
    ]);

    // Update fraud metrics
    await updateFraudMetrics(data.merchant_id, data.verified, data.risk_score);

  } catch (error) {
    console.error('Error logging handshake attempt:', error);
  }
}

/**
 * Update fraud metrics
 */
async function updateFraudMetrics(merchantId, verified, riskScore) {
  try {
    const redis = getRedisClient();
    const key = `fraud_metrics:${merchantId}`;
    
    // Increment counters
    await redis.hincrby(key, 'total_handshakes', 1);
    
    if (verified) {
      await redis.hincrby(key, 'successful_handshakes', 1);
    } else {
      await redis.hincrby(key, 'failed_handshakes', 1);
    }
    
    // Update risk score
    if (riskScore > 0.7) {
      await redis.hincrby(key, 'high_risk_handshakes', 1);
    }
    
    // Set expiration
    await redis.expire(key, 86400); // 24 hours
    
  } catch (error) {
    console.error('Error updating fraud metrics:', error);
  }
}

module.exports = {
  verifyHandshake,
  validateMutualProof,
  detectFraudPatterns,
  logHandshakeAttempt
};
