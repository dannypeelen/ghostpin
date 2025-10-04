const { Pool } = require('pg');

let pool = null;

/**
 * Initialize database connection pool
 */
async function initializeDatabase() {
  try {
    pool = new Pool({
      user: process.env.DB_USER || 'ghostpin',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'ghostpin',
      password: process.env.DB_PASSWORD || 'password',
      port: process.env.DB_PORT || 5432,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    console.log('✅ Database connected successfully');
    
    // Create tables if they don't exist
    await createTables();
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

/**
 * Create necessary database tables
 */
async function createTables() {
  const client = await pool.connect();
  
  try {
    // Merchants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id SERIAL PRIMARY KEY,
        merchant_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        public_key TEXT NOT NULL,
        origin VARCHAR(255) NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Verification logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_logs (
        id SERIAL PRIMARY KEY,
        merchant_id VARCHAR(255) NOT NULL,
        origin VARCHAR(255) NOT NULL,
        nonce VARCHAR(255) NOT NULL,
        verified BOOLEAN NOT NULL,
        reason TEXT,
        attestation_score DECIMAL(3,2),
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_logs_merchant_id 
      ON verification_logs(merchant_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_logs_created_at 
      ON verification_logs(created_at)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_logs_verified 
      ON verification_logs(verified)
    `);

    // Fraud alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fraud_alerts (
        id SERIAL PRIMARY KEY,
        merchant_id VARCHAR(255) NOT NULL,
        alert_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        description TEXT NOT NULL,
        metadata JSONB,
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);

    console.log('✅ Database tables created/verified');
    
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get database client
 */
function getDatabaseClient() {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ Database connection closed');
  }
}

module.exports = {
  initializeDatabase,
  getDatabaseClient,
  closeDatabase
};
