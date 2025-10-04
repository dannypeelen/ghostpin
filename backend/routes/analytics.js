const express = require('express');
const { getDatabaseClient } = require('../utils/database');
const { getFraudMetrics, storeAnalyticsData } = require('../utils/redis');

const router = express.Router();

/**
 * GET /api/analytics/overview
 * Get analytics overview for merchant
 */
router.get('/overview/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { period = '24h' } = req.query;
    
    const db = getDatabaseClient();
    
    // Calculate time range
    const timeRange = getTimeRange(period);
    
    // Get verification statistics
    const verificationStats = await db.query(`
      SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful_verifications,
        COUNT(CASE WHEN verified = false THEN 1 END) as failed_verifications,
        AVG(CASE WHEN verified = true THEN attestation_score END) as avg_attestation_score
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
    `, [merchant_id, timeRange]);
    
    // Get failure reasons
    const failureReasons = await db.query(`
      SELECT 
        reason,
        COUNT(*) as count
      FROM verification_logs 
      WHERE merchant_id = $1 AND verified = false AND created_at >= $2
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 10
    `, [merchant_id, timeRange]);
    
    // Get hourly breakdown
    const hourlyBreakdown = await db.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as attempts,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
      GROUP BY hour
      ORDER BY hour
    `, [merchant_id, timeRange]);
    
    // Get fraud alerts
    const fraudAlerts = await db.query(`
      SELECT 
        alert_type,
        severity,
        description,
        created_at
      FROM fraud_alerts 
      WHERE merchant_id = $1 AND created_at >= $2
      ORDER BY created_at DESC
      LIMIT 20
    `, [merchant_id, timeRange]);
    
    const overview = {
      period,
      time_range: {
        start: timeRange,
        end: new Date().toISOString()
      },
      verification_stats: verificationStats.rows[0],
      failure_reasons: failureReasons.rows,
      hourly_breakdown: hourlyBreakdown.rows,
      fraud_alerts: fraudAlerts.rows,
      generated_at: new Date().toISOString()
    };
    
    res.json(overview);
    
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

/**
 * GET /api/analytics/fraud-metrics
 * Get fraud detection metrics
 */
router.get('/fraud-metrics/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    
    // Get real-time fraud metrics from Redis
    const redis = require('../utils/redis');
    const fraudMetrics = await redis.getFraudMetrics(merchant_id);
    
    // Get historical fraud data from database
    const db = getDatabaseClient();
    const historicalData = await db.query(`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN verified = false THEN 1 END) as fraud_attempts,
        ROUND(
          COUNT(CASE WHEN verified = false THEN 1 END)::decimal / COUNT(*) * 100, 2
        ) as fraud_rate
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY date
      ORDER BY date
    `, [merchant_id]);
    
    // Calculate risk score
    const riskScore = calculateRiskScore(fraudMetrics, historicalData.rows);
    
    res.json({
      merchant_id,
      real_time_metrics: fraudMetrics,
      historical_data: historicalData.rows,
      risk_score: riskScore,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Fraud metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch fraud metrics' });
  }
});

/**
 * GET /api/analytics/domains
 * Get domain analysis for fraud detection
 */
router.get('/domains/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { period = '7d' } = req.query;
    
    const db = getDatabaseClient();
    const timeRange = getTimeRange(period);
    
    // Get domain statistics
    const domainStats = await db.query(`
      SELECT 
        origin,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful_requests,
        COUNT(CASE WHEN verified = false THEN 1 END) as failed_requests,
        ROUND(
          COUNT(CASE WHEN verified = false THEN 1 END)::decimal / COUNT(*) * 100, 2
        ) as failure_rate,
        AVG(attestation_score) as avg_attestation_score
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
      GROUP BY origin
      ORDER BY failure_rate DESC
    `, [merchant_id, timeRange]);
    
    // Get suspicious domains (high failure rate)
    const suspiciousDomains = domainStats.rows.filter(domain => 
      domain.failure_rate > 50 || domain.avg_attestation_score < 0.5
    );
    
    res.json({
      merchant_id,
      period,
      domain_statistics: domainStats.rows,
      suspicious_domains: suspiciousDomains,
      total_domains: domainStats.rows.length,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Domain analysis error:', error);
    res.status(500).json({ error: 'Failed to fetch domain analysis' });
  }
});

/**
 * POST /api/analytics/log-event
 * Log custom analytics event
 */
router.post('/log-event', async (req, res) => {
  try {
    const { merchant_id, event_type, event_data, metadata } = req.body;
    
    if (!merchant_id || !event_type) {
      return res.status(400).json({ error: 'merchant_id and event_type are required' });
    }
    
    const event = {
      merchant_id,
      event_type,
      event_data,
      metadata,
      timestamp: new Date().toISOString()
    };
    
    // Store in Redis for real-time analytics
    await storeAnalyticsData(event);
    
    // Store in database for historical analysis
    const db = getDatabaseClient();
    await db.query(`
      INSERT INTO analytics_events (merchant_id, event_type, event_data, metadata, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [merchant_id, event_type, JSON.stringify(event_data), JSON.stringify(metadata)]);
    
    res.json({ success: true, event_id: event.timestamp });
    
  } catch (error) {
    console.error('Log event error:', error);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

/**
 * Calculate risk score based on fraud metrics
 */
function calculateRiskScore(realTimeMetrics, historicalData) {
  let riskScore = 0;
  
  // Real-time factors
  const totalAttempts = parseInt(realTimeMetrics.total_attempts || 0);
  const failedAttempts = parseInt(realTimeMetrics.failed_verifications || 0);
  
  if (totalAttempts > 0) {
    const failureRate = failedAttempts / totalAttempts;
    riskScore += failureRate * 50; // Up to 50 points for failure rate
  }
  
  // Historical factors
  if (historicalData.length > 0) {
    const recentData = historicalData.slice(-7); // Last 7 days
    const avgFraudRate = recentData.reduce((sum, day) => sum + parseFloat(day.fraud_rate || 0), 0) / recentData.length;
    riskScore += avgFraudRate * 0.5; // Up to 50 points for historical fraud rate
  }
  
  // Volume factor
  if (totalAttempts > 100) {
    riskScore += Math.min(10, (totalAttempts - 100) / 10); // Up to 10 points for high volume
  }
  
  return Math.min(100, Math.max(0, riskScore));
}

/**
 * Get time range based on period parameter
 */
function getTimeRange(period) {
  const now = new Date();
  
  switch (period) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

module.exports = router;
