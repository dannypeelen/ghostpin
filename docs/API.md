# GhostPIN API Documentation

## Overview

The GhostPIN API provides cryptographic verification services for anti-phishing payment protection. All API endpoints require proper authentication and follow RESTful conventions.

## Base URL

```
Production: https://api.ghostpin.com
Development: http://localhost:3001
```

## Authentication

GhostPIN uses JWT tokens for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### Verification

#### POST /api/verify

Verifies a GhostPIN authentication payload.

**Request Body:**
```json
{
  "merchant_id": "string",
  "origin": "string",
  "nonce": "string",
  "payment_intent": {
    "amount": "number",
    "currency": "string"
  },
  "signature": "string",
  "timestamp": "number"
}
```

**Response:**
```json
{
  "verified": "boolean",
  "reason": "string",
  "attestation_score": "number",
  "verification_token": "string",
  "expires_at": "string"
}
```

**Example:**
```bash
curl -X POST https://api.ghostpin.com/api/verify \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "acme-corp",
    "origin": "https://acme.shop",
    "nonce": "abcd1234...",
    "payment_intent": {"amount": 999, "currency": "USD"},
    "signature": "base64sig",
    "timestamp": 1733313400
  }'
```

#### GET /api/verify/status/:nonce

Check verification status of a nonce.

**Response:**
```json
{
  "nonce": "string",
  "status": "string",
  "timestamp": "string"
}
```

### Dashboard

#### GET /api/dashboard/metrics/:merchant_id

Get dashboard metrics for a merchant.

**Query Parameters:**
- `period` (optional): Time period (1h, 24h, 7d, 30d). Default: 24h

**Response:**
```json
{
  "merchant_id": "string",
  "period": "string",
  "metrics": {
    "total_verifications": "number",
    "successful_verifications": "number",
    "failed_verifications": "number",
    "success_rate": "number",
    "avg_attestation_score": "number",
    "unique_domains": "number",
    "unique_ips": "number"
  },
  "fraud_metrics": "object",
  "recent_activity": "array",
  "fraud_alerts": "array"
}
```

#### GET /api/dashboard/charts/:merchant_id

Get chart data for dashboard.

**Query Parameters:**
- `period` (optional): Time period (1h, 24h, 7d, 30d). Default: 24h

**Response:**
```json
{
  "merchant_id": "string",
  "period": "string",
  "hourly_data": "array",
  "domain_data": "array",
  "failure_reasons": "array"
}
```

#### GET /api/dashboard/alerts/:merchant_id

Get fraud alerts and notifications.

**Query Parameters:**
- `status` (optional): Alert status (all, unresolved, resolved). Default: all

**Response:**
```json
{
  "merchant_id": "string",
  "alerts": "array",
  "statistics": "object"
}
```

#### POST /api/dashboard/alerts/:alert_id/resolve

Resolve a fraud alert.

**Request Body:**
```json
{
  "resolution_notes": "string"
}
```

#### GET /api/dashboard/export/:merchant_id

Export dashboard data.

**Query Parameters:**
- `format` (optional): Export format (json, csv). Default: json
- `period` (optional): Time period (1h, 24h, 7d, 30d). Default: 7d

### Analytics

#### GET /api/analytics/overview/:merchant_id

Get analytics overview for merchant.

**Query Parameters:**
- `period` (optional): Time period (1h, 24h, 7d, 30d). Default: 24h

**Response:**
```json
{
  "period": "string",
  "time_range": {
    "start": "string",
    "end": "string"
  },
  "verification_stats": "object",
  "failure_reasons": "array",
  "hourly_breakdown": "array",
  "fraud_alerts": "array"
}
```

#### GET /api/analytics/fraud-metrics/:merchant_id

Get fraud detection metrics.

**Response:**
```json
{
  "merchant_id": "string",
  "real_time_metrics": "object",
  "historical_data": "array",
  "risk_score": "number"
}
```

#### GET /api/analytics/domains/:merchant_id

Get domain analysis for fraud detection.

**Query Parameters:**
- `period` (optional): Time period (1h, 24h, 7d, 30d). Default: 7d

**Response:**
```json
{
  "merchant_id": "string",
  "period": "string",
  "domain_statistics": "array",
  "suspicious_domains": "array",
  "total_domains": "number"
}
```

#### POST /api/analytics/log-event

Log custom analytics event.

**Request Body:**
```json
{
  "merchant_id": "string",
  "event_type": "string",
  "event_data": "object",
  "metadata": "object"
}
```

## Error Handling

All API endpoints return appropriate HTTP status codes and error messages.

### Status Codes

- `200` - Success
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (invalid authentication)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

### Error Response Format

```json
{
  "error": "string",
  "message": "string",
  "code": "string",
  "details": "object"
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `MISSING_FIELDS` | Required fields are missing |
| `INVALID_SIGNATURE` | Cryptographic signature is invalid |
| `INVALID_NONCE` | Nonce is invalid or has been used |
| `ORIGIN_MISMATCH` | Request origin doesn't match registered domain |
| `TIMESTAMP_TOO_OLD` | Request timestamp is too old |
| `RATE_LIMITED` | Too many requests from this IP |
| `MERCHANT_NOT_FOUND` | Merchant ID not found |
| `INVALID_PAYMENT_INTENT` | Payment intent is invalid |

## Rate Limiting

API requests are rate limited to prevent abuse:

- **Verification endpoints**: 100 requests per minute per IP
- **Dashboard endpoints**: 1000 requests per hour per merchant
- **Analytics endpoints**: 500 requests per hour per merchant

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Webhooks

GhostPIN can send webhooks for important events:

### Webhook Events

- `verification.success` - Successful verification
- `verification.failed` - Failed verification
- `fraud.alert` - Fraud alert triggered
- `merchant.updated` - Merchant configuration updated

### Webhook Payload

```json
{
  "event": "string",
  "merchant_id": "string",
  "timestamp": "string",
  "data": "object"
}
```

### Webhook Security

Webhooks are signed with HMAC-SHA256. Verify the signature:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## SDK Integration

### JavaScript SDK

```javascript
// Initialize GhostPIN
const ghostpin = new GhostPIN({
  merchantId: 'your-merchant-id',
  apiUrl: 'https://api.ghostpin.com'
});

// Verify payment
const result = await ghostpin.verifyPayment({
  amount: 1000,
  currency: 'USD'
});

if (result.verified) {
  // Proceed with payment
  processPayment();
}
```

### Event Handling

```javascript
// Listen for verification events
ghostpin.on('verification', (event) => {
  console.log('Verification result:', event.detail);
});

// Listen for errors
ghostpin.on('error', (event) => {
  console.error('GhostPIN error:', event.detail);
});
```

## Testing

### Test Environment

Use the test environment for development:

```
Base URL: https://api-test.ghostpin.com
```

### Test Merchants

Test merchants are available for development:

- `demo-merchant` - Basic test merchant
- `test-store` - Advanced test merchant
- `fraud-test` - Fraud detection testing

### Test Cards

Use these test payment intents:

```json
{
  "amount": 100,
  "currency": "USD",
  "description": "Test payment"
}
```

## Support

For API support and questions:

- **Documentation**: [docs.ghostpin.com](https://docs.ghostpin.com)
- **Support**: [support@ghostpin.com](mailto:support@ghostpin.com)
- **Status**: [status.ghostpin.com](https://status.ghostpin.com)
