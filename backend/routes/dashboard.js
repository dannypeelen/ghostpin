const express = require('express');
const { getDatabaseClient } = require('../utils/database');
const { getFraudMetrics } = require('../utils/redis');

const router = express.Router();

/**
 * GET /api/dashboard/metrics
 * Get dashboard metrics for merchant
 */
router.get('/metrics/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { period = '24h' } = req.query;
    
    const db = getDatabaseClient();
    const timeRange = getTimeRange(period);
    
    // Get key metrics
    const metrics = await db.query(`
      SELECT 
        COUNT(*) as total_verifications,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful_verifications,
        COUNT(CASE WHEN verified = false THEN 1 END) as failed_verifications,
        ROUND(
          COUNT(CASE WHEN verified = true THEN 1 END)::decimal / NULLIF(COUNT(*), 0) * 100, 2
        ) as success_rate,
        AVG(attestation_score) as avg_attestation_score,
        COUNT(DISTINCT origin) as unique_domains,
        COUNT(DISTINCT ip_address) as unique_ips
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
    `, [merchant_id, timeRange]);
    
    // Get real-time fraud metrics
    const fraudMetrics = await getFraudMetrics(merchant_id);
    
    // Get recent activity
    const recentActivity = await db.query(`
      SELECT 
        origin,
        verified,
        reason,
        attestation_score,
        created_at
      FROM verification_logs 
      WHERE merchant_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [merchant_id]);
    
    // Get fraud alerts
    const fraudAlerts = await db.query(`
      SELECT 
        alert_type,
        severity,
        description,
        created_at,
        resolved
      FROM fraud_alerts 
      WHERE merchant_id = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [merchant_id]);
    
    res.json({
      merchant_id,
      period,
      metrics: metrics.rows[0],
      fraud_metrics: fraudMetrics,
      recent_activity: recentActivity.rows,
      fraud_alerts: fraudAlerts.rows,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

/**
 * GET /api/dashboard/charts
 * Get chart data for dashboard
 */
router.get('/charts/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { period = '24h' } = req.query;
    
    const db = getDatabaseClient();
    const timeRange = getTimeRange(period);
    
    // Get hourly verification data
    const hourlyData = await db.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as total,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful,
        COUNT(CASE WHEN verified = false THEN 1 END) as failed
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
      GROUP BY hour
      ORDER BY hour
    `, [merchant_id, timeRange]);
    
    // Get domain breakdown
    const domainData = await db.query(`
      SELECT 
        origin,
        COUNT(*) as total,
        COUNT(CASE WHEN verified = true THEN 1 END) as successful,
        ROUND(
          COUNT(CASE WHEN verified = true THEN 1 END)::decimal / COUNT(*) * 100, 2
        ) as success_rate
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
      GROUP BY origin
      ORDER BY total DESC
      LIMIT 10
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
    
    res.json({
      merchant_id,
      period,
      hourly_data: hourlyData.rows,
      domain_data: domainData.rows,
      failure_reasons: failureReasons.rows,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Dashboard charts error:', error);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

/**
 * GET /api/dashboard/alerts
 * Get fraud alerts and notifications
 */
router.get('/alerts/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { status = 'all' } = req.query;
    
    const db = getDatabaseClient();
    
    let whereClause = 'WHERE merchant_id = $1';
    let params = [merchant_id];
    
    if (status === 'unresolved') {
      whereClause += ' AND resolved = false';
    } else if (status === 'resolved') {
      whereClause += ' AND resolved = true';
    }
    
    const alerts = await db.query(`
      SELECT 
        id,
        alert_type,
        severity,
        description,
        metadata,
        resolved,
        created_at,
        resolved_at
      FROM fraud_alerts 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 100
    `, params);
    
    // Get alert statistics
    const alertStats = await db.query(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(CASE WHEN resolved = false THEN 1 END) as unresolved_alerts,
        COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_severity,
        COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_severity,
        COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_severity
      FROM fraud_alerts 
      WHERE merchant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
    `, [merchant_id]);
    
    res.json({
      merchant_id,
      alerts: alerts.rows,
      statistics: alertStats.rows[0],
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Dashboard alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * POST /api/dashboard/alerts/:alert_id/resolve
 * Resolve a fraud alert
 */
router.post('/alerts/:alert_id/resolve', async (req, res) => {
  try {
    const { alert_id } = req.params;
    const { resolution_notes } = req.body;
    
    const db = getDatabaseClient();
    
    await db.query(`
      UPDATE fraud_alerts 
      SET resolved = true, resolved_at = NOW(), resolution_notes = $1
      WHERE id = $2
    `, [resolution_notes, alert_id]);
    
    res.json({ success: true, message: 'Alert resolved successfully' });
    
  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

/**
 * GET /api/dashboard/export
 * Export dashboard data
 */
router.get('/export/:merchant_id', async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { format = 'json', period = '7d' } = req.query;
    
    const db = getDatabaseClient();
    const timeRange = getTimeRange(period);
    
    // Get verification logs
    const logs = await db.query(`
      SELECT 
        origin,
        nonce,
        verified,
        reason,
        attestation_score,
        ip_address,
        user_agent,
        created_at
      FROM verification_logs 
      WHERE merchant_id = $1 AND created_at >= $2
      ORDER BY created_at DESC
    `, [merchant_id, timeRange]);
    
    // Get fraud alerts
    const alerts = await db.query(`
      SELECT 
        alert_type,
        severity,
        description,
        metadata,
        resolved,
        created_at,
        resolved_at
      FROM fraud_alerts 
      WHERE merchant_id = $1 AND created_at >= $2
      ORDER BY created_at DESC
    `, [merchant_id, timeRange]);
    
    const exportData = {
      merchant_id,
      period,
      time_range: {
        start: timeRange.toISOString(),
        end: new Date().toISOString()
      },
      verification_logs: logs.rows,
      fraud_alerts: alerts.rows,
      exported_at: new Date().toISOString()
    };
    
    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ghostpin-export-${merchant_id}-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json(exportData);
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

/**
 * Convert data to CSV format
 */
function convertToCSV(data) {
  const headers = [
    'timestamp', 'origin', 'nonce', 'verified', 'reason', 
    'attestation_score', 'ip_address', 'user_agent'
  ];
  
  const rows = data.verification_logs.map(log => [
    log.created_at,
    log.origin,
    log.nonce,
    log.verified,
    log.reason,
    log.attestation_score,
    log.ip_address,
    log.user_agent
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${field || ''}"`).join(','))
  ].join('\n');
  
  return csvContent;
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
