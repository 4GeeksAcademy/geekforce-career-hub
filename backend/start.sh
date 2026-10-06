#!/bin/sh
set -e
# Apply database migrations, then start the API (which also serves the web app).
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
