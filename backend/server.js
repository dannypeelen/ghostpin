const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const verifierRoutes = require('./routes/verifier');
const handshakeRoutes = require('./routes/handshake-simple'); // Use simplified handshake
const { initializeDatabase } = require('./utils/database');
const { initializeRedis } = require('./utils/redis');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

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

// API routes - Core functionality only
app.use('/api/verify', verifierRoutes);
app.use('/api/verify-handshake', handshakeRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize services and start server
async function startServer() {
  try {
    console.log('🚀 Starting GhostPIN server...');
    
    // Initialize database
    await initializeDatabase();
    console.log('✅ Database connected');
    
    // Initialize Redis
    await initializeRedis();
    console.log('✅ Redis connected');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`✅ GhostPIN server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🛡️ Real demo: http://localhost:${PORT}/real`);
      console.log(`⚠️ Scam demo: http://localhost:${PORT}/scam`);
      console.log(`🔐 Handshake API: http://localhost:${PORT}/api/verify-handshake`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();