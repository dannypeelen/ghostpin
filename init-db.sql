-- GhostPIN Database Initialization
-- This script runs when the PostgreSQL container starts

-- Create the ghostpin database (if not exists)
-- Note: The database is already created by POSTGRES_DB environment variable

-- Create additional users if needed
-- CREATE USER ghostpin_readonly WITH PASSWORD 'readonly_password';
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO ghostpin_readonly;

-- Set up initial configuration
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- Create initial merchant for testing (tables will be created by the application)
-- INSERT INTO merchants (merchant_id, name, public_key, origin, active) 
-- VALUES (
--   'demo-merchant', 
--   'Demo Merchant', 
--   '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
--   'https://demo-merchant.com',
--   true
-- ) ON CONFLICT (merchant_id) DO NOTHING;

-- Create test data for development (tables will be created by the application)
-- INSERT INTO verification_logs (merchant_id, origin, nonce, verified, reason, attestation_score, ip_address, user_agent, created_at)
-- VALUES 
--   ('demo-merchant', 'https://demo-merchant.com', 'test-nonce-1', true, 'All validations passed', 0.95, '127.0.0.1', 'Mozilla/5.0...', NOW() - INTERVAL '1 hour'),
--   ('demo-merchant', 'https://demo-merchant.com', 'test-nonce-2', false, 'Invalid signature', 0.2, '127.0.0.1', 'Mozilla/5.0...', NOW() - INTERVAL '2 hours'),
--   ('demo-merchant', 'https://demo-merchant.com', 'test-nonce-3', true, 'All validations passed', 0.88, '127.0.0.1', 'Mozilla/5.0...', NOW() - INTERVAL '3 hours')
-- ON CONFLICT DO NOTHING;
