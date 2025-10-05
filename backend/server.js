const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const verifierRoutes = require('./routes/verifier');
const gatewayRoutes = require('./routes/gateway');
const analyticsRoutes = require('./routes/analytics');
const dashboardRoutes = require('./routes/dashboard');
const handshakeRoutes = require('./routes/handshake');

const enableMfaDemo = process.env.ENABLE_MFA_DEMO === 'true';
const demoMfaRoutes = enableMfaDemo ? require('./routes/demoMfa') : null;
const { initializeDatabase } = require('./utils/database');
const { initializeRedis } = require('./utils/redis');

const app = express();
const PORT = process.env.PORT || 3001;

// Security
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/sdk', express.static(path.join(__dirname, '../sdk')));
app.use('/demo', express.static(path.join(__dirname, '../demo')));

// GhostPIN verification endpoints (root scope)
app.use('/', gatewayRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Demo website hosting
app.get("/real", (req, res) => {
  res.sendFile(path.join(__dirname, "../demo/real-website.html"));
});

app.get("/scam", (req, res) => {
  res.sendFile(path.join(__dirname, "../demo/scam-website.html"));
});

// API routes
app.use('/api/verify', verifierRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/verify-handshake', handshakeRoutes);

if (enableMfaDemo && demoMfaRoutes) {
  app.use('/api/demo-mfa', demoMfaRoutes);
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 fallback
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Bootstrapping
async function startServer() {
  try {
    await initializeDatabase();
    await initializeRedis();
    
    app.listen(PORT, () => {
      console.log(`🚀 GhostPIN Backend running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔹 Real site: http://localhost:${PORT}/real`);
      console.log(`🔸 Scam site: http://localhost:${PORT}/scam`);
      if (enableMfaDemo) {
        console.log(`🔐 MFA demo API: http://localhost:${PORT}/api/demo-mfa`);
      } else {
        console.log('ℹ️ Set ENABLE_MFA_DEMO=true to enable MFA demo endpoints.');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
