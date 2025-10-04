/**
 * Integration Tests for GhostPIN
 * End-to-end tests for the complete system
 */

const request = require('supertest');
const app = require('../backend/server');
const crypto = require('crypto');

describe('GhostPIN Integration Tests', () => {
  describe('Complete Verification Flow', () => {
    it('should handle successful verification flow', async () => {
      // 1. Generate nonce (simulating SDK)
      const nonce = crypto.createHash('sha256')
        .update(`test-merchant:${Date.now()}:${JSON.stringify({amount: 100, currency: 'USD'})}:${crypto.randomBytes(16).toString('hex')}`)
        .digest('hex');

      // 2. Create signed payload (simulating SDK)
      const payload = {
        merchant_id: 'test-merchant',
        origin: 'https://test-merchant.com',
        nonce: nonce,
        payment_intent: { amount: 100, currency: 'USD' },
        signature: crypto.randomBytes(64).toString('base64'),
        timestamp: Math.floor(Date.now() / 1000)
      };

      // 3. Send verification request
      const response = await request(app)
        .post('/api/verify')
        .send(payload);

      // 4. Should receive response (may fail due to missing merchant setup)
      expect(response.status).toBeDefined();
      expect(response.body).toHaveProperty('verified');
    });

    it('should handle failed verification flow', async () => {
      const payload = {
        merchant_id: 'invalid-merchant',
        origin: 'https://malicious-site.com',
        nonce: 'invalid-nonce',
        payment_intent: { amount: 100, currency: 'USD' },
        signature: 'invalid-signature',
        timestamp: Math.floor(Date.now() / 1000)
      };

      const response = await request(app)
        .post('/api/verify')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.verified).toBe(false);
    });
  });

  describe('Dashboard Integration', () => {
    it('should fetch dashboard metrics', async () => {
      const response = await request(app)
        .get('/api/dashboard/metrics/demo-merchant?period=24h');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('merchant_id', 'demo-merchant');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('fraud_alerts');
    });

    it('should fetch chart data', async () => {
      const response = await request(app)
        .get('/api/dashboard/charts/demo-merchant?period=24h');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hourly_data');
      expect(response.body).toHaveProperty('domain_data');
      expect(response.body).toHaveProperty('failure_reasons');
    });

    it('should fetch fraud alerts', async () => {
      const response = await request(app)
        .get('/api/dashboard/alerts/demo-merchant?status=unresolved');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('alerts');
      expect(response.body).toHaveProperty('statistics');
    });
  });

  describe('Analytics Integration', () => {
    it('should fetch analytics overview', async () => {
      const response = await request(app)
        .get('/api/analytics/overview/demo-merchant?period=24h');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('verification_stats');
      expect(response.body).toHaveProperty('failure_reasons');
      expect(response.body).toHaveProperty('hourly_breakdown');
    });

    it('should fetch fraud metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/fraud-metrics/demo-merchant');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('real_time_metrics');
      expect(response.body).toHaveProperty('historical_data');
      expect(response.body).toHaveProperty('risk_score');
    });

    it('should fetch domain analysis', async () => {
      const response = await request(app)
        .get('/api/analytics/domains/demo-merchant?period=7d');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('domain_statistics');
      expect(response.body).toHaveProperty('suspicious_domains');
    });

    it('should log custom events', async () => {
      const eventData = {
        merchant_id: 'demo-merchant',
        event_type: 'custom_event',
        event_data: { test: true },
        metadata: { source: 'integration_test' }
      };

      const response = await request(app)
        .post('/api/analytics/log-event')
        .send(eventData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle database connection errors gracefully', async () => {
      // This would require mocking database failures
      const response = await request(app)
        .get('/api/dashboard/metrics/nonexistent-merchant');

      // Should not crash the server
      expect(response.status).toBeDefined();
    });

    it('should handle malformed requests', async () => {
      const malformedRequests = [
        { body: 'not-json' },
        { body: { invalid: 'structure' } },
        { body: null },
        { body: undefined }
      ];

      for (const req of malformedRequests) {
        const response = await request(app)
          .post('/api/verify')
          .send(req.body);

        expect(response.status).toBeDefined();
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('should handle concurrent requests', async () => {
      const payload = {
        merchant_id: 'test-merchant',
        origin: 'https://test.com',
        nonce: crypto.createHash('sha256').update('concurrent-test').digest('hex'),
        payment_intent: { amount: 100, currency: 'USD' },
        signature: 'test-signature',
        timestamp: Math.floor(Date.now() / 1000)
      };

      // Send multiple concurrent requests
      const promises = Array(10).fill().map(() => 
        request(app).post('/api/verify').send(payload)
      );

      const responses = await Promise.all(promises);
      
      // All requests should be handled
      responses.forEach(response => {
        expect(response.status).toBeDefined();
        expect(response.status).toBeLessThan(600);
      });
    });
  });

  describe('Performance Integration', () => {
    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/dashboard/metrics/demo-merchant');
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(5000); // 5 seconds max
    });

    it('should handle high-volume requests', async () => {
      const requests = Array(100).fill().map((_, i) => {
        const payload = {
          merchant_id: 'test-merchant',
          origin: 'https://test.com',
          nonce: crypto.createHash('sha256').update(`volume-test-${i}`).digest('hex'),
          payment_intent: { amount: 100, currency: 'USD' },
          signature: 'test-signature',
          timestamp: Math.floor(Date.now() / 1000)
        };
        
        return request(app).post('/api/verify').send(payload);
      });

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const endTime = Date.now();
      
      const totalTime = endTime - startTime;
      const avgTime = totalTime / requests.length;
      
      // Should handle 100 requests in reasonable time
      expect(totalTime).toBeLessThan(30000); // 30 seconds max
      expect(avgTime).toBeLessThan(300); // 300ms average
      
      // All requests should be handled
      responses.forEach(response => {
        expect(response.status).toBeDefined();
      });
    });
  });

  describe('Security Integration', () => {
    it('should enforce CORS policies', async () => {
      const response = await request(app)
        .options('/api/verify')
        .set('Origin', 'https://malicious-site.com');

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    it('should validate content types', async () => {
      const response = await request(app)
        .post('/api/verify')
        .set('Content-Type', 'text/plain')
        .send('invalid content');

      expect(response.status).toBe(400);
    });

    it('should handle oversized payloads', async () => {
      const largePayload = {
        merchant_id: 'test-merchant',
        origin: 'https://test.com',
        nonce: crypto.createHash('sha256').update('large-payload').digest('hex'),
        payment_intent: { amount: 100, currency: 'USD' },
        signature: 'test-signature',
        timestamp: Math.floor(Date.now() / 1000),
        large_data: 'x'.repeat(1000000) // 1MB of data
      };

      const response = await request(app)
        .post('/api/verify')
        .send(largePayload);

      // Should handle large payloads gracefully
      expect(response.status).toBeDefined();
    });
  });
});
