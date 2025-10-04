const express = require('express');
const crypto = require('crypto');

const router = express.Router();

/**
 * POST /api/verify-handshake
 * Simplified handshake verification for demo purposes
 */
router.post('/', async (req, res) => {
  try {
    const {
      handshake_proof,
      merchant_id,
      origin,
      timestamp
    } = req.body;

    console.log('🔐 Handshake verification request:', {
      merchant_id,
      origin,
      has_proof: !!handshake_proof
    });

    // Basic validation
    if (!handshake_proof || !merchant_id || !origin) {
      return res.status(400).json({
        verified: false,
        reason: 'Missing required fields'
      });
    }

    // Simulate handshake verification
    const isVerified = await simulateHandshakeVerification(handshake_proof, merchant_id, origin);
    
    if (isVerified) {
      console.log('✅ Handshake verified successfully');
      res.json({
        verified: true,
        risk_score: 0.1, // Low risk for demo
        fraud_indicators: [],
        handshake_id: handshake_proof.handshake_id || 'demo-handshake-' + Date.now(),
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('❌ Handshake verification failed');
      res.status(400).json({
        verified: false,
        reason: 'Handshake verification failed'
      });
    }

  } catch (error) {
    console.error('Handshake verification error:', error);
    res.status(500).json({
      verified: false,
      reason: 'Internal server error'
    });
  }
});

/**
 * Simulate handshake verification for demo
 */
async function simulateHandshakeVerification(handshakeProof, merchantId, origin) {
  try {
    // Check if merchant challenge exists
    if (!handshakeProof.merchant_challenge) {
      console.log('❌ Missing merchant challenge');
      return false;
    }

    // Check if user response exists
    if (!handshakeProof.user_response) {
      console.log('❌ Missing user response');
      return false;
    }

    // Check if mutual proof exists
    if (!handshakeProof.mutual_proof) {
      console.log('❌ Missing mutual proof');
      return false;
    }

    // Simulate domain verification
    const allowedOrigins = [
      'http://localhost:3001',
      'https://secure-store.com',
      'https://demo-merchant.com'
    ];

    if (!allowedOrigins.some(allowed => origin.includes(allowed.replace('https://', '').replace('http://', '')))) {
      console.log('❌ Origin not allowed:', origin);
      return false;
    }

    // Simulate merchant verification
    const allowedMerchants = ['secure-store', 'demo-merchant', 'acme-corp'];
    if (!allowedMerchants.includes(merchantId)) {
      console.log('❌ Merchant not allowed:', merchantId);
      return false;
    }

    console.log('✅ All handshake checks passed');
    return true;

  } catch (error) {
    console.error('Error in handshake verification:', error);
    return false;
  }
}

module.exports = router;
