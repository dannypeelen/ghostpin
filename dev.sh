#!/bin/bash

# === CONFIGURATION ===
DB_NAME="ghostpin"
DB_USER="ghostpin"
DB_PASS="ghostpin_dev_password"
DB_PORT="5432"
DB_HOST="127.0.0.1"
ENV_FILE=".env"

echo "🚀 Starting PostgreSQL setup for $DB_NAME..."

if ! command -v psql > /dev/null; then
    echo "❌ psql command not found."
    if [[ "$(uname -s)" == "Darwin" ]]; then
        echo "➡️  Install PostgreSQL with Homebrew:"
        echo "    brew install postgresql"
        echo "    brew services start postgresql"
    else
        echo "➡️  Install PostgreSQL using your package manager (e.g. apt, yum)."
    fi
    echo "🔁 Re-run ./dev.sh after PostgreSQL is installed and running."
    exit 1
fi

OS_NAME=$(uname -s)
echo "🔍 Detected OS: $OS_NAME"

# Attempt to ensure PostgreSQL is running (best effort, OS-specific)
if [[ "$OS_NAME" == "Darwin" ]]; then
    if command -v brew > /dev/null; then
        echo "🧰 Ensuring PostgreSQL service is running via Homebrew..."
        brew services start postgresql@16 > /dev/null 2>&1 || \
        brew services start postgresql@15 > /dev/null 2>&1 || \
        brew services start postgresql@14 > /dev/null 2>&1 || \
        brew services start postgresql > /dev/null 2>&1 || \
        echo "ℹ️  Could not manage PostgreSQL with brew services. Ensure it is running manually."
    else
        echo "ℹ️  Homebrew not detected. Make sure PostgreSQL is running manually."
    fi
elif command -v systemctl > /dev/null; then
    echo "🧰 Ensuring PostgreSQL service is running via systemctl..."
    sudo systemctl enable postgresql > /dev/null 2>&1 || true
    sudo systemctl start postgresql > /dev/null 2>&1 || true
elif command -v service > /dev/null; then
    echo "🧰 Ensuring PostgreSQL service is running via service..."
    sudo service postgresql start > /dev/null 2>&1 || true
else
    echo "ℹ️  Could not auto-start PostgreSQL. Ensure it is running before continuing."
fi

# Determine helper for running superuser commands
psql_superuser() {
    if id -u postgres > /dev/null 2>&1; then
        sudo -u postgres psql "$@"
    else
        psql "$@"
    fi
}

echo "🗄️  Creating role and database if needed..."
USER_EXISTS=$(psql_superuser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")
if [[ "$USER_EXISTS" != "1" ]]; then
    if ! psql_superuser -d postgres -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"; then
        echo "❌ Failed to create user ${DB_USER}. Ensure you have PostgreSQL superuser access."
        exit 1
    fi
fi

DB_EXISTS=$(psql_superuser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")
if [[ "$DB_EXISTS" != "1" ]]; then
    if ! psql_superuser -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"; then
        echo "❌ Failed to create database ${DB_NAME}. Ensure you have PostgreSQL superuser access."
        exit 1
    fi
fi

if ! psql_superuser -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"; then
    echo "⚠️  Could not grant privileges on ${DB_NAME} to ${DB_USER}."
fi

echo "✅ Database and user setup complete."

echo "📦 Ensuring handshake_logs table exists..."
PGPASSWORD=$DB_PASS psql -v ON_ERROR_STOP=1 -U $DB_USER -d $DB_NAME -h $DB_HOST -p $DB_PORT <<'SQL'
CREATE TABLE IF NOT EXISTS handshake_logs (
  id SERIAL PRIMARY KEY,
  merchant_id VARCHAR(255) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  handshake_id VARCHAR(255) NOT NULL,
  verified BOOLEAN NOT NULL,
  reason TEXT,
  risk_score DECIMAL(3,2),
  fraud_indicators JSONB,
  step VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
SQL

if [[ $? -eq 0 ]]; then
    echo "✅ handshake_logs table ready."
else
    echo "⚠️  Could not create handshake_logs table. Check connection details."
fi

echo "🧾 Updating $ENV_FILE with database settings..."
python3 <<PY
from pathlib import Path

env_path = Path("$ENV_FILE")
if not env_path.exists():
    example = Path("env.example")
    if example.exists():
        env_path.write_text(example.read_text())
    else:
        env_path.write_text("")

lines = env_path.read_text().splitlines()
settings = {
    "DB_HOST": "$DB_HOST",
    "DB_PORT": "$DB_PORT",
    "DB_NAME": "$DB_NAME",
    "DB_USER": "$DB_USER",
    "DB_PASSWORD": "$DB_PASS",
}

existing = {line.split('=', 1)[0]: idx for idx, line in enumerate(lines) if '=' in line}

for key, value in settings.items():
    content = f"{key}={value}"
    if key in existing:
        lines[existing[key]] = content
    else:
        lines.append(content)

env_path.write_text("\n".join(lines) + "\n")
PY

if [[ $? -eq 0 ]]; then
    echo "✅ .env file updated successfully."
else
    echo "⚠️  Failed to update .env file."
fi

echo "🎉 PostgreSQL setup complete!"
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Host: $DB_HOST:$DB_PORT"
