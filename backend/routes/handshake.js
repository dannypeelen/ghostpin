const express = require('express');
const crypto = require('crypto');
const { verifyHandshake, validateMutualProof, detectFraudPatterns } = require('../services/handshake');
const { logHandshakeAttempt } = require('../services/analytics');

const router = express.Router();

/**
 * POST /api/verify-handshake
 * Verify complete two-way handshake
 */
router.post('/', async (req, res) => {
  try {
    const {
      handshake_proof,
      merchant_id,
      origin,
      timestamp
    } = req.body;

    // Validate handshake proof structure
    if (!handshake_proof || !handshake_proof.merchant_challenge || !handshake_proof.user_response) {
      return res.status(400).json({
        verified: false,
        error: 'Invalid handshake proof structure',
        reason: 'Missing required handshake components'
      });
    }

    // Step 1: Verify merchant challenge
    const merchantValid = await verifyMerchantChallenge(handshake_proof.merchant_challenge, merchant_id, origin);
    if (!merchantValid.valid) {
      await logHandshakeAttempt({
        merchant_id,
        origin,
        handshake_id: handshake_proof.handshake_id,
        verified: false,
        reason: merchantValid.reason,
        step: 'merchant_challenge'
      });

      return res.status(400).json({
        verified: false,
        error: 'Merchant challenge verification failed',
        reason: merchantValid.reason
      });
    }

    // Step 2: Verify user response
    const userValid = await verifyUserResponse(handshake_proof.user_response, handshake_proof.merchant_challenge);
    if (!userValid.valid) {
      await logHandshakeAttempt({
        merchant_id,
        origin,
        handshake_id: handshake_proof.handshake_id,
        verified: false,
        reason: userValid.reason,
        step: 'user_response'
      });

      return res.status(400).json({
        verified: false,
        error: 'User response verification failed',
        reason: userValid.reason
      });
    }

    // Step 3: Verify mutual proof
    const mutualValid = await validateMutualProof(handshake_proof);
    if (!mutualValid.valid) {
      await logHandshakeAttempt({
        merchant_id,
        origin,
        handshake_id: handshake_proof.handshake_id,
        verified: false,
        reason: mutualValid.reason,
        step: 'mutual_proof'
      });

      return res.status(400).json({
        verified: false,
        error: 'Mutual proof verification failed',
        reason: mutualValid.reason
      });
    }

    // Step 4: Fraud detection
    const fraudIndicators = await detectFraudPatterns({
      merchant_id,
      origin,
      handshake_proof,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    if (fraudIndicators.risk_score > 0.7) {
      await logHandshakeAttempt({
        merchant_id,
        origin,
        handshake_id: handshake_proof.handshake_id,
        verified: false,
        reason: 'High fraud risk detected',
        fraud_indicators: fraudIndicators,
        step: 'fraud_detection'
      });

      return res.status(400).json({
        verified: false,
        error: 'Fraud risk detected',
        reason: 'Handshake failed fraud detection',
        risk_score: fraudIndicators.risk_score
      });
    }

    // Step 5: Generate handshake completion token
    const handshakeToken = await generateHandshakeToken({
      merchant_id,
      handshake_id: handshake_proof.handshake_id,
      verified: true,
      risk_score: fraudIndicators.risk_score
    });

    // Log successful handshake
    await logHandshakeAttempt({
      merchant_id,
      origin,
      handshake_id: handshake_proof.handshake_id,
      verified: true,
      reason: 'Handshake completed successfully',
      risk_score: fraudIndicators.risk_score,
      step: 'completed'
    });

    res.json({
      verified: true,
      handshake_token: handshakeToken,
      risk_score: fraudIndicators.risk_score,
      fraud_indicators: fraudIndicators,
      expires_at: new Date(Date.now() + 300000).toISOString() // 5 minutes
    });

  } catch (error) {
    console.error('Handshake verification error:', error);
    
    await logHandshakeAttempt({
      merchant_id: req.body.merchant_id,
      origin: req.body.origin,
      handshake_id: req.body.handshake_proof?.handshake_id,
      verified: false,
      reason: 'Internal server error',
      step: 'error'
    });

    res.status(500).json({
      verified: false,
      error: 'Handshake verification failed',
      reason: 'Internal server error'
    });
  }
});

/**
 * Verify merchant challenge
 */
async function verifyMerchantChallenge(merchantChallenge, merchantId, origin) {
  try {
    // Verify merchant ID matches
    if (merchantChallenge.merchant_id !== merchantId) {
      return { valid: false, reason: 'Merchant ID mismatch' };
    }

    // Verify domain binding
    const expectedDomain = process.env[`MERCHANT_${merchantId.toUpperCase()}_ORIGIN`];
    if (expectedDomain && origin !== expectedDomain) {
      return { valid: false, reason: 'Domain binding mismatch' };
    }

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
    const expectedDomainProof = await generateExpectedDomainProof(origin);
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
async function verifyUserResponse(userResponse, merchantChallenge) {
  try {
    // Verify WebAuthn credential
    if (!userResponse.credential || !userResponse.credential.id) {
      return { valid: false, reason: 'Missing WebAuthn credential' };
    }

    // Verify user proof
    const expectedUserProof = await generateExpectedUserProof(userResponse.credential, merchantChallenge);
    if (userResponse.user_proof !== expectedUserProof) {
      return { valid: false, reason: 'User proof mismatch' };
    }

    // Verify device binding
    if (!userResponse.device_binding) {
      return { valid: false, reason: 'Missing device binding' };
    }

    return { valid: true, reason: 'User response valid' };

  } catch (error) {
    console.error('User response verification error:', error);
    return { valid: false, reason: 'User response verification error' };
  }
}

/**
 * Generate expected domain proof
 */
async function generateExpectedDomainProof(origin) {
  const domainData = {
    domain: new URL(origin).hostname,
    protocol: new URL(origin).protocol,
    timestamp: Date.now()
  };

  return crypto.createHash('sha256').update(JSON.stringify(domainData)).digest('hex');
}

/**
 * Generate expected user proof
 */
async function generateExpectedUserProof(credential, merchantChallenge) {
  const proofData = {
    credential_id: Buffer.from(credential.id).toString('base64'),
    merchant_challenge: merchantChallenge,
    timestamp: Date.now()
  };

  return crypto.createHash('sha256').update(JSON.stringify(proofData)).digest('hex');
}

/**
 * Generate handshake token
 */
async function generateHandshakeToken(data) {
  const tokenData = {
    ...data,
    timestamp: Date.now(),
    expires: Date.now() + 300000 // 5 minutes
  };

  return crypto.createHash('sha256').update(JSON.stringify(tokenData)).digest('hex');
}

module.exports = router;
