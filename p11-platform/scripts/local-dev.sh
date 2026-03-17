#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/apps/web"
DATA_ENGINE_DIR="${ROOT_DIR}/services/data-engine"
SUPABASE_DIR="${ROOT_DIR}/supabase"

WEB_PID=""
DATA_ENGINE_PID=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1"
    exit 1
  fi
}

load_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✅ ${label} ready at ${url}"
      return 0
    fi
    sleep 1
  done

  echo "❌ Timed out waiting for ${label} at ${url}"
  return 1
}

cleanup() {
  local exit_code=$?

  echo
  echo "Shutting down local services..."

  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi

  if [[ -n "${DATA_ENGINE_PID}" ]] && kill -0 "${DATA_ENGINE_PID}" 2>/dev/null; then
    kill "${DATA_ENGINE_PID}" 2>/dev/null || true
  fi

  wait "${WEB_PID}" "${DATA_ENGINE_PID}" 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

echo "Starting P11 local stack..."

require_command npm
require_command python3
require_command curl

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "❌ Missing shared env file: ${ROOT_DIR}/.env"
  echo "Create it before running local startup."
  exit 1
fi

# Export the shared root env files into the process before starting services.
# This keeps the local Supabase overlay authoritative even if app-local env files exist.
load_env_file "${ROOT_DIR}/.env"
load_env_file "${ROOT_DIR}/.env.local"

if [[ ! -d "${WEB_DIR}/node_modules" ]]; then
  echo "❌ Web dependencies are not installed."
  echo "Run: cd \"${WEB_DIR}\" && npm install"
  exit 1
fi

if port_in_use 3000; then
  echo "❌ Port 3000 is already in use. Stop the existing web server first."
  exit 1
fi

if port_in_use 8000; then
  echo "❌ Port 8000 is already in use. Stop the existing data engine first."
  exit 1
fi

if [[ -f "${SUPABASE_DIR}/config.toml" ]]; then
  echo "Starting local Supabase services..."
  (
    cd "${ROOT_DIR}"
    npm run supabase:start
  )
else
  echo "No local Supabase config detected. Using Supabase credentials from ${ROOT_DIR}/.env."
fi

echo "Starting data engine..."
(
  cd "${DATA_ENGINE_DIR}"
  bash ./start.sh
) &
DATA_ENGINE_PID=$!

wait_for_http "http://localhost:8000/health" "Data engine" 90

echo "Starting web app..."
(
  cd "${WEB_DIR}"
  npm run dev
) &
WEB_PID=$!

wait_for_http "http://localhost:3000/api/health" "Web app" 120

echo
echo "P11 local stack is ready."
echo "Web app: http://localhost:3000"
echo "Data engine: http://localhost:8000"
echo "Press Ctrl+C to stop all local services."

wait "${DATA_ENGINE_PID}" "${WEB_PID}"
