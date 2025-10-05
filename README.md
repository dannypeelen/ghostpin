# GhostPIN - Anti-Phishing Payment Verification System

**GhostPIN** is a comprehensive anti-phishing payment verification system that provides cryptographic proof of authenticity between users, merchant pages, and payment gateways. It makes phishing and fake checkout pages cryptographically impossible.

## 🔐 Core Features

- **One-Line SDK Integration**: Simple `<script>` tag integration for merchants
- **Visual Nonce Embedding**: Steganographic nonce embedding in checkout buttons
- **WebAuthn Integration**: Face ID, Touch ID, hardware key, and OTP fallback
- **Cryptographic Verification**: Nonce + page authenticity bound to signed payload
- **Real-Time Fraud Analytics**: Comprehensive dashboard with fraud detection
- **Privacy-First**: No biometrics stored, no user tracking

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Development Server

```bash
npm run dev
```

### 4. Access Dashboard

- Backend API: http://localhost:3001
- Dashboard: http://localhost:3000
- Health Check: http://localhost:3001/health

## 🔑 MFA Demo Walkthrough

GhostPIN ships with a self-contained MFA demo that showcases TOTP enrollment and verification without requiring user sign-in.

1. Enable the feature flags in your environment:
   ```env
   ENABLE_MFA_DEMO=true
   NEXT_PUBLIC_ENABLE_MFA_DEMO=true
   ```
   Optional: set `MFA_DEMO_TTL_SECONDS` to adjust how long demo sessions stay valid (default 300 seconds).
   Frontend builds look for `NEXT_PUBLIC_*` values in `dashboard/.env.local`, so run `cp dashboard/.env.example dashboard/.env.local` to apply the defaults locally.
2. Start the stack (`npm run dev`) and open `http://localhost:3000/demo`.
3. Scan the QR code with any authenticator app, then enter the current 6-digit code to prove the second factor end-to-end.

When deploying, keep the same flags enabled to offer the same experience remotely. Disable them by setting the values to `false` if the public demo should be hidden.

## 📁 Project Structure

```
GhostPIN/
├── backend/                 # Node.js backend service
│   ├── routes/             # API route handlers
│   ├── services/           # Business logic
│   ├── utils/              # Database and Redis utilities
│   └── server.js           # Main server file
├── sdk/                    # Client-side SDK
│   └── ghostpin.js         # Main SDK file
├── dashboard/              # Next.js dashboard
│   ├── components/        # React components
│   ├── pages/             # Next.js pages
│   └── styles/            # CSS styles
├── tests/                 # Test suites
│   ├── verification.test.js
│   ├── sdk.test.js
│   ├── security.test.js
│   └── integration.test.js
└── docs/                  # Documentation
```

## 🔧 Configuration

### Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ghostpin
DB_USER=ghostpin
DB_PASSWORD=your_password

# Redis
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your_jwt_secret
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Merchant Configuration
MERCHANT_DEMO_MERCHANT_ORIGIN=https://demo-merchant.com
```

### Merchant Setup

1. **Register Merchant**:
```javascript
// Add merchant to database
INSERT INTO merchants (merchant_id, name, public_key, origin, active) 
VALUES ('your-merchant', 'Your Store', 'your-public-key', 'https://yourstore.com', true);
```

2. **Configure Environment**:
```env
MERCHANT_YOUR_MERCHANT_ORIGIN=https://yourstore.com
```

## 💻 SDK Integration

### Basic Integration

```html
<!DOCTYPE html>
<html>
<head>
    <title>Your Store</title>
</head>
<body>
    <!-- Add GhostPIN SDK -->
    <script 
        src="https://cdn.ghostpin.com/ghostpin.js"
        data-merchant-id="your-merchant-id"
        data-api-url="https://api.ghostpin.com">
    </script>
    
    <!-- Your checkout button -->
    <button id="checkout-btn" onclick="initiatePayment()">
        Pay $99.99
    </button>
    
    <script>
        async function initiatePayment() {
            try {
                const result = await window.GhostPIN.verifyPayment({
                    amount: 9999,
                    currency: 'USD'
                }, {
                    targetElement: document.getElementById('checkout-btn')
                });
                
                if (result.verified) {
                    // Proceed with payment
                    processPayment();
                } else {
                    alert('Verification failed: ' + result.reason);
                }
            } catch (error) {
                console.error('GhostPIN error:', error);
            }
        }
    </script>
</body>
</html>
```

### Advanced Integration

```javascript
// Initialize GhostPIN with custom options
const ghostpin = new GhostPIN({
    merchantId: 'your-merchant-id',
    apiUrl: 'https://api.ghostpin.com',
    fallbackToOTP: true
});

// Listen for events
ghostpin.on('verification', (event) => {
    console.log('Verification result:', event.detail);
});

// Custom verification
const result = await ghostpin.verifyPayment({
    amount: 5000,
    currency: 'USD',
    description: 'Premium Plan'
}, {
    targetElement: document.getElementById('checkout-btn'),
    requireBiometric: true
});
```

## 🛡️ Security Features

### Cryptographic Security

- **SHA-256 Nonce Generation**: Cryptographically secure nonce generation
- **WebAuthn Integration**: Hardware-backed authentication
- **Signature Verification**: Cryptographic signature validation
- **Replay Attack Prevention**: Nonce-based replay protection
- **Timestamp Validation**: Time-based request validation

### Fraud Detection

- **Origin Validation**: Domain binding verification
- **Rate Limiting**: Request rate limiting
- **Anomaly Detection**: Behavioral pattern analysis
- **Real-Time Monitoring**: Live fraud detection
- **Audit Logging**: Comprehensive audit trails

## 📊 Dashboard Features

### Real-Time Metrics

- **Verification Statistics**: Success/failure rates
- **Fraud Alerts**: Real-time security alerts
- **Domain Analysis**: Suspicious domain detection
- **Performance Metrics**: Response times and throughput

### Analytics

- **Hourly Breakdown**: Time-based analysis
- **Domain Statistics**: Origin-based metrics
- **Failure Analysis**: Error reason tracking
- **Risk Scoring**: Dynamic risk assessment

## 🧪 Testing

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Security tests
npm run test:security

# SDK tests
npm run test:sdk
```

### Test Coverage

```bash
npm run test:coverage
```

## 🚀 Deployment

### Docker Deployment

```bash
# Build Docker image
docker build -t ghostpin .

# Run with Docker Compose
docker-compose up -d
```

### Production Deployment

1. **Set up production environment**:
```bash
export NODE_ENV=production
export DB_HOST=your-db-host
export REDIS_URL=your-redis-url
export JWT_SECRET=your-secure-secret
```

2. **Deploy backend**:
```bash
npm run build:backend
npm start
```

3. **Deploy dashboard**:
```bash
cd dashboard
npm run build
npm start
```

### Environment-Specific Configuration

#### Development
```env
NODE_ENV=development
DB_HOST=localhost
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=http://localhost:3000
```

#### Production
```env
NODE_ENV=production
DB_HOST=your-production-db
REDIS_URL=redis://your-redis-cluster
ALLOWED_ORIGINS=https://yourdomain.com
```

## 📈 Monitoring

### Health Checks

- **API Health**: `GET /health`
- **Database Health**: Automatic connection monitoring
- **Redis Health**: Cache availability monitoring

### Metrics

- **Response Times**: API performance metrics
- **Error Rates**: Failure rate tracking
- **Throughput**: Request volume monitoring
- **Fraud Detection**: Security metrics

### Logging

- **Structured Logging**: JSON-formatted logs
- **Audit Trails**: Complete verification logs
- **Error Tracking**: Comprehensive error logging
- **Performance Logs**: Response time tracking

## 🔒 Security Best Practices

### Merchant Security

1. **HTTPS Only**: Enforce HTTPS for all communications
2. **Domain Validation**: Strict origin validation
3. **Key Management**: Secure key storage and rotation
4. **Rate Limiting**: Implement request rate limiting

### API Security

1. **Input Validation**: Comprehensive input sanitization
2. **Authentication**: JWT-based authentication
3. **Authorization**: Role-based access control
4. **Encryption**: End-to-end encryption

### Data Protection

1. **No Biometric Storage**: Biometrics never stored
2. **Minimal Data Collection**: Only necessary data
3. **Secure Transmission**: TLS 1.3 encryption
4. **Data Retention**: Automatic data cleanup

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

### Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/ghostpin.git
cd ghostpin

# Install dependencies
npm install

# Set up development environment
cp .env.example .env
# Edit .env with your configuration

# Start development servers
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs.ghostpin.com](https://docs.ghostpin.com)
- **API Reference**: [api.ghostpin.com/docs](https://api.ghostpin.com/docs)
- **Support**: [support@ghostpin.com](mailto:support@ghostpin.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/ghostpin/issues)

## 🎯 Roadmap

### Phase 1 (Current)
- ✅ Core SDK implementation
- ✅ Backend verification service
- ✅ Basic dashboard
- ✅ Security testing

### Phase 2 (Next)
- 🔄 Advanced fraud detection
- 🔄 Machine learning integration
- 🔄 Multi-tenant support
- 🔄 Mobile SDK

### Phase 3 (Future)
- 📋 Blockchain integration
- 📋 Decentralized verification
- 📋 Cross-platform support
- 📋 Enterprise features

---

**GhostPIN** - Making online payments cryptographically secure, one verification at a time.
