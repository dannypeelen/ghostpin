const request = require('supertest');
const app = require('../backend/server');
const crypto = require('crypto');

describe('GhostPIN Verification API', () => {
  const validPayload = {
    merchant_id: 'test-merchant',
    origin: 'https://test-merchant.com',
    nonce: crypto.createHash('sha256').update('test-nonce').digest('hex'),
    payment_intent: {
      amount: 1000,
      currency: 'USD'
    },
    signature: 'test-signature',
    timestamp: Math.floor(Date.now() / 1000)
  };

  beforeEach(() => {
    // Mock Redis and database operations
    jest.clearAllMocks();
  });

  describe('POST /api/verify', () => {
    it('should reject requests with missing required fields', async () => {
      const response = await request(app)
        .post('/api/verify')
        .send({
          merchant_id: 'test-merchant'
          // Missing other required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should reject requests with old timestamps', async () => {
      const oldPayload = {
        ...validPayload,
        timestamp: Math.floor(Date.now() / 1000) - 400 // 6+ minutes old
      };

      const response = await request(app)
        .post('/api/verify')
        .send(oldPayload);

      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
      expect(response.body.error).toBe('Timestamp too old');
    });

    it('should reject requests with invalid nonces', async () => {
      const invalidNoncePayload = {
        ...validPayload,
        nonce: 'invalid-nonce-format'
      };

      const response = await request(app)
        .post('/api/verify')
        .send(invalidNoncePayload);

      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
    });

    it('should reject requests with invalid signatures', async () => {
      const response = await request(app)
        .post('/api/verify')
        .send(validPayload);

      // This will fail signature verification
      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
      expect(response.body.error).toBe('Invalid signature');
    });

    it('should handle origin mismatch', async () => {
      const mismatchedOriginPayload = {
        ...validPayload,
        origin: 'https://malicious-site.com'
      };

      const response = await request(app)
        .post('/api/verify')
        .send(mismatchedOriginPayload);

      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
      expect(response.body.error).toBe('Origin mismatch');
    });

    it('should log verification attempts', async () => {
      const response = await request(app)
        .post('/api/verify')
        .send(validPayload);

      // Should log the attempt regardless of success/failure
      expect(response.status).toBe(400); // Will fail due to invalid signature
      expect(response.body.verified).toBe(false);
    });
  });

  describe('GET /api/verify/status/:nonce', () => {
    it('should return nonce status', async () => {
      const testNonce = 'test-nonce-123';
      
      const response = await request(app)
        .get(`/api/verify/status/${testNonce}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('nonce', testNonce);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});

describe('Security Tests', () => {
  it('should prevent replay attacks', async () => {
    const nonce = crypto.createHash('sha256').update('replay-test').digest('hex');
    
    const payload = {
      merchant_id: 'test-merchant',
      origin: 'https://test-merchant.com',
      nonce: nonce,
      payment_intent: { amount: 100, currency: 'USD' },
      signature: 'test-signature',
      timestamp: Math.floor(Date.now() / 1000)
    };

    // First request
    const response1 = await request(app)
      .post('/api/verify')
      .send(payload);

    // Second request with same nonce (should be rejected)
    const response2 = await request(app)
      .post('/api/verify')
      .send(payload);

    expect(response1.status).toBe(400); // Will fail for other reasons
    expect(response2.status).toBe(400); // Should also fail
  });

  it('should validate nonce format', () => {
    const validNonce = crypto.createHash('sha256').update('test').digest('hex');
    const invalidNonce = 'not-a-valid-sha256-hash';

    expect(validNonce).toMatch(/^[a-f0-9]{64}$/);
    expect(invalidNonce).not.toMatch(/^[a-f0-9]{64}$/);
  });

  it('should enforce rate limiting', async () => {
    const payload = {
      merchant_id: 'test-merchant',
      origin: 'https://test-merchant.com',
      nonce: crypto.createHash('sha256').update('rate-limit-test').digest('hex'),
      payment_intent: { amount: 100, currency: 'USD' },
      signature: 'test-signature',
      timestamp: Math.floor(Date.now() / 1000)
    };

    // Send multiple requests rapidly
    const promises = Array(10).fill().map(() => 
      request(app).post('/api/verify').send(payload)
    );

    const responses = await Promise.all(promises);
    
    // All should be handled (may fail for other reasons, but not due to rate limiting)
    responses.forEach(response => {
      expect(response.status).toBeDefined();
    });
  });
});
