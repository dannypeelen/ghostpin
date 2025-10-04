const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { verifySignature, validateNonce, logVerification } = require('../services/verification');
const { getRedisClient } = require('../utils/redis');

const router = express.Router();

/**
 * POST /api/verify
 * Verifies a GhostPIN authentication payload
 */
router.post('/', async (req, res) => {
  try {
    const {
      merchant_id,
      origin,
      nonce,
      payment_intent,
      signature,
      timestamp,
      user_agent,
      ip_address
    } = req.body;

    // Validate required fields
    if (!merchant_id || !origin || !nonce || !signature || !timestamp) {
      return res.status(400).json({
        verified: false,
        error: 'Missing required fields',
        reason: 'merchant_id, origin, nonce, signature, and timestamp are required'
      });
    }

    // Check timestamp freshness (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > 300) { // 5 minutes
      return res.status(400).json({
        verified: false,
        error: 'Timestamp too old',
        reason: 'Request timestamp is more than 5 minutes old'
      });
    }

    // Validate nonce (prevent replay attacks)
    const nonceValid = await validateNonce(nonce, merchant_id);
    if (!nonceValid) {
      await logVerification({
        merchant_id,
        origin,
        nonce,
        verified: false,
        reason: 'Invalid or replayed nonce',
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });
      
      return res.status(400).json({
        verified: false,
        error: 'Invalid nonce',
        reason: 'Nonce has been used or is invalid'
      });
    }

    // Verify cryptographic signature
    const signatureValid = await verifySignature({
      merchant_id,
      origin,
      nonce,
      payment_intent,
      timestamp,
      signature
    });

    if (!signatureValid.valid) {
      await logVerification({
        merchant_id,
        origin,
        nonce,
        verified: false,
        reason: signatureValid.reason,
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });
      
      return res.status(400).json({
        verified: false,
        error: 'Invalid signature',
        reason: signatureValid.reason
      });
    }

    // Validate origin matches expected domain
    const expectedOrigin = process.env[`MERCHANT_${merchant_id.toUpperCase()}_ORIGIN`];
    if (expectedOrigin && origin !== expectedOrigin) {
      await logVerification({
        merchant_id,
        origin,
        nonce,
        verified: false,
        reason: 'Origin mismatch',
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });
      
      return res.status(400).json({
        verified: false,
        error: 'Origin mismatch',
        reason: 'Request origin does not match registered merchant domain'
      });
    }

    // Mark nonce as used
    const redis = getRedisClient();
    await redis.setex(`nonce:${nonce}`, 300, 'used'); // 5 minute TTL

    // Calculate attestation score
    const attestationScore = calculateAttestationScore({
      timeDiff,
      origin,
      payment_intent,
      user_agent: req.get('User-Agent')
    });

    // Log successful verification
    await logVerification({
      merchant_id,
      origin,
      nonce,
      verified: true,
      reason: 'All validations passed',
      attestation_score: attestationScore,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    // Generate verification token for merchant
    const verificationToken = jwt.sign(
      {
        merchant_id,
        nonce,
        verified: true,
        timestamp: now,
        attestation_score: attestationScore
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      verified: true,
      reason: 'origin, signature, and nonce valid',
      attestation_score: attestationScore,
      verification_token: verificationToken,
      expires_at: new Date(now + 3600 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Verification error:', error);
    
    // Log failed verification
    await logVerification({
      merchant_id: req.body.merchant_id,
      origin: req.body.origin,
      nonce: req.body.nonce,
      verified: false,
      reason: 'Internal server error',
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.status(500).json({
      verified: false,
      error: 'Verification failed',
      reason: 'Internal server error'
    });
  }
});

/**
 * Calculate attestation score based on various factors
 */
function calculateAttestationScore({ timeDiff, origin, payment_intent, user_agent }) {
  let score = 1.0;
  
  // Time factor (fresher is better)
  if (timeDiff > 60) score -= 0.1;
  if (timeDiff > 180) score -= 0.2;
  
  // Origin validation
  if (origin.startsWith('https://')) score += 0.1;
  else score -= 0.2;
  
  // Payment amount factor
  if (payment_intent?.amount) {
    const amount = payment_intent.amount;
    if (amount > 1000) score -= 0.1; // High value transactions
    if (amount > 10000) score -= 0.2;
  }
  
  // User agent validation
  if (user_agent && user_agent.includes('bot')) score -= 0.5;
  if (user_agent && user_agent.includes('curl')) score -= 0.3;
  
  return Math.max(0, Math.min(1, score));
}

/**
 * GET /api/verify/status/:nonce
 * Check verification status of a nonce
 */
router.get('/status/:nonce', async (req, res) => {
  try {
    const { nonce } = req.params;
    const redis = getRedisClient();
    const status = await redis.get(`nonce:${nonce}`);
    
    res.json({
      nonce,
      status: status ? 'used' : 'pending',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
