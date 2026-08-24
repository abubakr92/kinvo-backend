#!/bin/bash
set -euo pipefail

# Deploys the Kinvo API onto the staging instance.
#
# Runs ON the instance, fetched from S3 and executed through SSM. It exists as a
# file rather than inline SSM commands because quoting a multi-step shell script
# through JSON is how mistakes get made.
#
# Why the image is built here rather than pushed:
# an 877MB push from a slow uplink times out repeatedly, while the source is
# 280KB and AWS builds it in a couple of minutes on its own network.
#
# Usage (from the instance, or via SSM):
#   deploy.sh <s3-bucket> <image-tag>

BUCKET="$1"
IMAGE="$2"

APP_DIR=/opt/kinvo
SRC_DIR="$APP_DIR/src"

echo "=== fetching source ==="
mkdir -p "$SRC_DIR"
cd "$SRC_DIR"
aws s3 cp "s3://$BUCKET/_deploy/kinvo-src.tar.gz" . --region us-east-1
tar xzf kinvo-src.tar.gz

echo "=== building runtime image ==="
docker build -t "$IMAGE" . 2>&1 | tail -5

# The runtime image installs production dependencies only, so the Prisma CLI is
# absent by design — it is a build tool, not something the API needs at run
# time. Migrations therefore run from the builder stage, which has it. This also
# keeps the CLI and its dependencies out of the image that faces the internet.
echo "=== building migrator (builder stage) ==="
docker build --target builder -t kinvo-migrator . 2>&1 | tail -3

echo "=== applying migrations ==="
docker run --rm \
  --network kinvo_default \
  --env-file "$APP_DIR/.env" \
  kinvo-migrator npx prisma migrate deploy 2>&1 | tail -15

echo "=== starting api ==="
cd "$APP_DIR"
docker compose up -d api

echo "=== waiting for health ==="
for i in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "api healthy after ${i}0s"
    break
  fi
  sleep 10
done

docker compose ps --format '{{.Name}} | {{.Status}}'
echo "=== deploy complete ==="
