#!/bin/bash
set -euxo pipefail

# Boots the Kinvo API on a fresh Amazon Linux 2023 instance.
#
# Runs once, as root, at first boot. Output goes to
# /var/log/cloud-init-output.log — read that first when something is wrong.
#
# Postgres and Redis run here in containers rather than as RDS and ElastiCache.
# That is a deliberate staging trade: about $27/month cheaper, and staging data
# is disposable so managed backups buy little. Production should use the managed
# services, which is a change to this file and the security groups, not to the
# application.

dnf update -y
dnf install -y docker

# Compose v2 as a Docker CLI plugin.
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

systemctl enable --now docker

APP_DIR=/opt/kinvo
mkdir -p "$APP_DIR"

# --- secrets ---------------------------------------------------------------
# Read from SSM through the instance role. Never baked into the image, never
# written to a file that outlives this script.
get_secret() {
  aws ssm get-parameter \
    --name "/${project}/${environment}/$1" \
    --with-decryption \
    --region "${aws_region}" \
    --query 'Parameter.Value' \
    --output text
}

JWT_ACCESS_SECRET="$(get_secret jwt_access_secret)"
JWT_REFRESH_SECRET="$(get_secret jwt_refresh_secret)"
DB_PASSWORD="$(get_secret db_password)"

# --- environment -----------------------------------------------------------
# NODE_ENV=production is not cosmetic. It is what makes env validation refuse a
# wildcard CORS origin and refuse MEDIA_AUTO_APPROVE_UPLOADS, and what stops
# forgot-password returning the reset token in the response body.
#
# No S3_ENDPOINT and no S3 keys: the SDK talks to real S3 and authenticates
# through the instance role.
cat > "$APP_DIR/.env" <<ENVFILE
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=${log_level}

DATABASE_URL=postgresql://kinvo:$DB_PASSWORD@postgres:5432/kinvo
REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ISSUER=kinvo

CORS_ORIGINS=https://admin.${project}.invalid
JSON_BODY_LIMIT=1mb

S3_REGION=${aws_region}
S3_MEDIA_BUCKET=${media_bucket}
S3_VERIFICATION_BUCKET=${verification_bucket}
S3_FORCE_PATH_STYLE=false
MEDIA_AUTO_APPROVE_UPLOADS=false
ENVFILE

chmod 600 "$APP_DIR/.env"

cat > "$APP_DIR/db.env" <<DBENV
POSTGRES_USER=kinvo
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=kinvo
DBENV

chmod 600 "$APP_DIR/db.env"

# --- compose ---------------------------------------------------------------
cat > "$APP_DIR/docker-compose.yml" <<'COMPOSE'
name: kinvo

services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    env_file: [db.env]
    volumes:
      - pgdata:/var/lib/postgresql/data
    # No ports mapping: reachable only on the compose network, never from
    # outside the instance.
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U kinvo -d kinvo']
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 20

  api:
    image: API_IMAGE_PLACEHOLDER
    restart: unless-stopped
    env_file: [.env]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    expose:
      - '3000'

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on: [api]

volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
COMPOSE

sed -i "s|API_IMAGE_PLACEHOLDER|${ecr_repository}:latest|" "$APP_DIR/docker-compose.yml"

# --- Caddy -----------------------------------------------------------------
# With a domain, Caddy obtains and renews a Let's Encrypt certificate itself.
# Without one, it serves plain HTTP and CloudFront provides TLS to the client —
# a certificate authority will not issue for a bare IP address.
if [ -n "${domain_name}" ]; then
  cat > "$APP_DIR/Caddyfile" <<CADDY
${domain_name} {
  encode gzip
  reverse_proxy api:3000
}
CADDY
else
  cat > "$APP_DIR/Caddyfile" <<'CADDY'
:80 {
  encode gzip
  reverse_proxy api:3000
}
CADDY
fi

# --- start -----------------------------------------------------------------
aws ecr get-login-password --region "${aws_region}" \
  | docker login --username AWS --password-stdin "${ecr_repository}"

cd "$APP_DIR"

# The image only exists after the first push, so a first boot legitimately has
# nothing to pull. Postgres and Redis still come up, and the deploy script
# starts the API once an image is available.
docker compose pull || true
docker compose up -d postgres redis caddy
docker compose up -d api || echo "No API image yet — push one, then run: cd /opt/kinvo && docker compose up -d api"

echo "kinvo bootstrap complete"
