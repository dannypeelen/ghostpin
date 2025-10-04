# GhostPIN Deployment Guide

This guide covers deploying GhostPIN in various environments, from development to production.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 13+
- Redis 6+
- Docker (optional)
- SSL certificates (production)

## Development Deployment

### 1. Local Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/ghostpin.git
cd ghostpin

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Start development servers
npm run dev
```

### 2. Development Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ghostpin_dev
DB_USER=ghostpin
DB_PASSWORD=dev_password

# Redis
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=dev-secret-key
ALLOWED_ORIGINS=http://localhost:3000

# Development flags
NODE_ENV=development
LOG_LEVEL=debug
```

## Production Deployment

### 1. Server Requirements

**Minimum Requirements:**
- CPU: 2 cores
- RAM: 4GB
- Storage: 20GB SSD
- Network: 100Mbps

**Recommended Requirements:**
- CPU: 4+ cores
- RAM: 8GB+
- Storage: 100GB+ SSD
- Network: 1Gbps

### 2. Database Setup

#### PostgreSQL Configuration

```bash
# Install PostgreSQL
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE ghostpin;
CREATE USER ghostpin WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE ghostpin TO ghostpin;
\q
```

#### Database Optimization

```sql
-- Optimize for GhostPIN workload
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- Restart PostgreSQL
sudo systemctl restart postgresql
```

### 3. Redis Setup

#### Redis Configuration

```bash
# Install Redis
sudo apt-get install redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
```

```conf
# Redis configuration for GhostPIN
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
tcp-keepalive 60
timeout 300
```

```bash
# Restart Redis
sudo systemctl restart redis-server
```

### 4. Application Deployment

#### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Build application
npm run build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ghostpin-backend',
    script: 'backend/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }, {
    name: 'ghostpin-dashboard',
    script: 'dashboard/server.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

### 5. Nginx Configuration

```nginx
# /etc/nginx/sites-available/ghostpin
server {
    listen 80;
    server_name api.ghostpin.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.ghostpin.com;

    ssl_certificate /etc/ssl/certs/ghostpin.crt;
    ssl_certificate_key /etc/ssl/private/ghostpin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # API proxy
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Dashboard proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 6. SSL Certificate Setup

#### Using Let's Encrypt

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d api.ghostpin.com -d dashboard.ghostpin.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### 7. Environment Variables (Production)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ghostpin
DB_USER=ghostpin
DB_PASSWORD=secure_production_password

# Redis
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-super-secure-jwt-secret-key
ALLOWED_ORIGINS=https://yourdomain.com,https://api.ghostpin.com

# Production flags
NODE_ENV=production
LOG_LEVEL=info
PORT=3001

# Merchant configuration
MERCHANT_ACME_CORP_ORIGIN=https://acme.shop
MERCHANT_SECURE_STORE_ORIGIN=https://secure-store.com
```

## Docker Deployment

### 1. Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:13
    environment:
      POSTGRES_DB: ghostpin
      POSTGRES_USER: ghostpin
      POSTGRES_PASSWORD: secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:6-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  backend:
    build: .
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
    ports:
      - "3001:3001"

  dashboard:
    build: ./dashboard
    environment:
      - NODE_ENV=production
    ports:
      - "3000:3000"

volumes:
  postgres_data:
  redis_data:
```

### 2. Dockerfile

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY backend/ ./backend/
COPY sdk/ ./sdk/

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start application
CMD ["node", "backend/server.js"]
```

### 3. Docker Commands

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Scale services
docker-compose up -d --scale backend=3

# Stop services
docker-compose down
```

## Kubernetes Deployment

### 1. Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ghostpin
```

### 2. ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ghostpin-config
  namespace: ghostpin
data:
  NODE_ENV: "production"
  DB_HOST: "postgres-service"
  REDIS_URL: "redis://redis-service:6379"
  LOG_LEVEL: "info"
```

### 3. Secrets

```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: ghostpin-secrets
  namespace: ghostpin
type: Opaque
data:
  DB_PASSWORD: <base64-encoded-password>
  JWT_SECRET: <base64-encoded-jwt-secret>
  REDIS_PASSWORD: <base64-encoded-redis-password>
```

### 4. Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ghostpin-backend
  namespace: ghostpin
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ghostpin-backend
  template:
    metadata:
      labels:
        app: ghostpin-backend
    spec:
      containers:
      - name: backend
        image: ghostpin:latest
        ports:
        - containerPort: 3001
        envFrom:
        - configMapRef:
            name: ghostpin-config
        - secretRef:
            name: ghostpin-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 5. Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: ghostpin-backend-service
  namespace: ghostpin
spec:
  selector:
    app: ghostpin-backend
  ports:
  - port: 80
    targetPort: 3001
  type: LoadBalancer
```

## Monitoring and Logging

### 1. Health Checks

```bash
# API health
curl https://api.ghostpin.com/health

# Database health
curl https://api.ghostpin.com/health/db

# Redis health
curl https://api.ghostpin.com/health/redis
```

### 2. Logging Configuration

```javascript
// logging.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

### 3. Monitoring Setup

```bash
# Install monitoring tools
npm install --save prom-client

# Add metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(register.metrics());
});
```

## Security Hardening

### 1. Firewall Configuration

```bash
# UFW setup
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3001/tcp
sudo ufw deny 5432/tcp
sudo ufw deny 6379/tcp
```

### 2. Database Security

```sql
-- Create read-only user for monitoring
CREATE USER ghostpin_readonly WITH PASSWORD 'readonly_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ghostpin_readonly;

-- Enable SSL
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET ssl_cert_file = '/etc/ssl/certs/server.crt';
ALTER SYSTEM SET ssl_key_file = '/etc/ssl/private/server.key';
```

### 3. Application Security

```bash
# Set secure file permissions
chmod 600 .env
chmod 700 logs/
chown -R ghostpin:ghostpin /opt/ghostpin

# Disable unnecessary services
sudo systemctl disable apache2
sudo systemctl disable mysql
```

## Backup and Recovery

### 1. Database Backup

```bash
# Create backup script
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U ghostpin ghostpin > backup_$DATE.sql
gzip backup_$DATE.sql
aws s3 cp backup_$DATE.sql.gz s3://ghostpin-backups/
```

### 2. Redis Backup

```bash
# Redis backup
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb /backups/redis_$(date +%Y%m%d).rdb
```

### 3. Application Backup

```bash
# Application backup
tar -czf ghostpin_$(date +%Y%m%d).tar.gz /opt/ghostpin
aws s3 cp ghostpin_$(date +%Y%m%d).tar.gz s3://ghostpin-backups/
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Check connection
   psql -h localhost -U ghostpin -d ghostpin
   ```

2. **Redis Connection Errors**
   ```bash
   # Check Redis status
   sudo systemctl status redis-server
   
   # Test connection
   redis-cli ping
   ```

3. **High Memory Usage**
   ```bash
   # Check memory usage
   free -h
   ps aux --sort=-%mem | head
   
   # Restart services
   sudo systemctl restart ghostpin-backend
   ```

### Performance Optimization

1. **Database Optimization**
   ```sql
   -- Analyze tables
   ANALYZE verification_logs;
   ANALYZE fraud_alerts;
   
   -- Update statistics
   UPDATE pg_stat_user_tables SET n_tup_ins = 0;
   ```

2. **Redis Optimization**
   ```bash
   # Monitor Redis memory
   redis-cli info memory
   
   # Clear old keys
   redis-cli --scan --pattern "nonce:*" | xargs redis-cli del
   ```

3. **Application Optimization**
   ```bash
   # Monitor CPU usage
   top -p $(pgrep -f "node.*server.js")
   
   # Check for memory leaks
   node --inspect server.js
   ```

## Maintenance

### Regular Maintenance Tasks

1. **Daily**
   - Check health endpoints
   - Monitor error logs
   - Verify backups

2. **Weekly**
   - Update dependencies
   - Clean old logs
   - Analyze performance metrics

3. **Monthly**
   - Security updates
   - Database maintenance
   - Capacity planning

### Update Procedures

```bash
# Update application
git pull origin main
npm install
npm run build
pm2 restart ghostpin-backend

# Update dependencies
npm audit fix
npm update

# Database migrations
npm run migrate
```

This deployment guide provides comprehensive instructions for deploying GhostPIN in various environments. Choose the deployment method that best fits your infrastructure and requirements.
