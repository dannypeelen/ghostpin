const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
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
  res.sendFile(path.join(__dirname, "demo/real-website.html"));
});

app.get("/scam", (req, res) => {
  res.sendFile(path.join(__dirname, "demo/scam-website.html"));
});

// Simple handshake endpoint for demo
app.post('/api/verify-handshake', (req, res) => {
  console.log('🔐 Handshake request received:', req.body);
  
  // Simulate successful handshake for demo
  res.json({
    verified: true,
    risk_score: 0.1,
    fraud_indicators: [],
    handshake_id: 'demo-handshake-' + Date.now(),
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ GhostPIN demo server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🛡️ Real demo: http://localhost:${PORT}/real`);
  console.log(`⚠️ Scam demo: http://localhost:${PORT}/scam`);
  console.log(`🔐 Handshake API: http://localhost:${PORT}/api/verify-handshake`);
});
