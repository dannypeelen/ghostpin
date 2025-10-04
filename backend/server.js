const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const verifierRoutes = require('./routes/verifier');
const analyticsRoutes = require('./routes/analytics');
const dashboardRoutes = require('./routes/dashboard');
const handshakeRoutes = require('./routes/handshake');
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/sdk', express.static(path.join(__dirname, '../sdk')));

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
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
