#!/usr/bin/env bash
# One-command setup for AI Studio (macOS, Linux, Git Bash / WSL on Windows):
# installs dependencies, rebuilds the Docker images, replaces the old containers with
# fresh ones and waits until everything is healthy.
#
#   ./setup.sh                 full setup / update (keeps database data)
#   ./setup.sh --no-cache      rebuild images from scratch
#   ./setup.sh --skip-local    Docker only (no local npm / Python install)
#   ./setup.sh --dev           also start the hot-reload frontend on :5173
#   ./setup.sh --reset-data    DELETE all database data and start clean (asks for confirmation)
#   ./setup.sh --yes           do not ask for confirmation
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=ai-studio   # must match "name:" in docker-compose.yml

NO_CACHE=0; SKIP_LOCAL=0; DEV=0; RESET=0; YES=0
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE=1 ;;
    --skip-local) SKIP_LOCAL=1 ;;
    --dev) DEV=1 ;;
    --reset-data) RESET=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)"; exit 1 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '    \033[33m[!] %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m[x] %s\033[0m\n' "$1"; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
step "Checking prerequisites"
has docker || fail "Docker is not installed. Install Docker: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker and run this script again."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required ('docker compose'). Update Docker."
info "Docker and Docker Compose are available."

# ---------------------------------------------------------------------------
step "Environment file"
if [ ! -f .env ]; then
  cp .env.example .env
  info "Created .env from .env.example (edit it to change passwords or ports)."
else
  info ".env already exists, keeping it."
fi

# ---------------------------------------------------------------------------
if [ "$SKIP_LOCAL" = 1 ]; then
  step "Local dependencies: skipped (--skip-local)"
else
  step "Installing local dependencies (for development, tests and the editor)"
  if has npm; then
    # 'npm ci' wipes node_modules, which fails while a dev server or editor holds a file open:
    # use it only for a fresh install, otherwise 'npm install' (follows the lockfile, touches only what changed).
    if [ -d node_modules ]; then NPM_CMD=install; else NPM_CMD=ci; fi
    info "npm $NPM_CMD (frontend workspace)..."
    npm "$NPM_CMD" --no-audit --no-fund || warn "npm $NPM_CMD failed (is 'npm run dev' or an editor locking node_modules?). Continuing with Docker."
  else
    warn "npm not found: skipping frontend dependencies (Docker builds the frontend anyway). Install Node 22 to develop locally."
  fi

  PY=""
  for c in python3 python; do
    if has "$c" && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi
  done
  if [ -n "$PY" ]; then
    [ -d .venv ] || { info "Creating Python virtual environment in .venv ..."; "$PY" -m venv .venv || warn "Could not create .venv."; }
    if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; else VPY=.venv/Scripts/python.exe; fi
    if [ -e "$VPY" ]; then
      info "Installing backend requirements into .venv ..."
      REQS=()
      while IFS= read -r f; do REQS+=(-r "$f"); done < <(find services -name requirements.txt)
      if "$VPY" -m pip install --quiet --disable-pip-version-check "${REQS[@]}"; then
        info "Backend tests: $VPY -m pytest tests"
      else
        warn "pip install failed. Continuing with Docker."
      fi
    else
      warn "No usable .venv. Continuing with Docker."
    fi
  else
    warn "Python 3.10+ not found: skipping backend test dependencies (the services run in Docker anyway)."
  fi
fi

# ---------------------------------------------------------------------------
COMPOSE=(docker compose -p "$PROJECT")
[ "$DEV" = 1 ] && COMPOSE+=(--profile dev)

step "Pulling the latest base images (postgres, pgadmin, adminer)"
"${COMPOSE[@]}" pull --ignore-buildable --quiet || warn "Could not pull newer images (offline?). Using the ones already downloaded."

if [ "$NO_CACHE" = 1 ]; then step "Building images from scratch (--no-cache)"; else step "Building images"; fi
BUILD=(build)
[ "$NO_CACHE" = 1 ] && BUILD+=(--no-cache)
if ! "${COMPOSE[@]}" "${BUILD[@]}" --pull; then
  # Usually a network/registry hiccup while checking for newer base images: retry with the cached ones.
  # Nothing has been stopped yet, so the running containers are untouched either way.
  warn "Build with fresh base images failed (network or Docker Hub unreachable?). Retrying with locally cached base images..."
  "${COMPOSE[@]}" "${BUILD[@]}" || fail "Image build failed. The previous containers are still running."
fi

if [ "$RESET" = 1 ]; then
  step "Reset requested: ALL database data (Postgres, pgAdmin) will be deleted"
  if [ "$YES" != 1 ]; then
    read -r -p "    Type 'yes' to confirm: " answer
    [ "$answer" = "yes" ] || fail "Reset cancelled."
  fi
fi

step "Removing old containers"
DOWN=(down --remove-orphans)
[ "$RESET" = 1 ] && DOWN+=(--volumes)
"${COMPOSE[@]}" "${DOWN[@]}"

step "Starting fresh containers and waiting until they are healthy"
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans --wait --wait-timeout 240

step "Cleaning up old images replaced by this build"
if docker image prune -f --filter "label=com.docker.compose.project=$PROJECT" >/dev/null 2>&1; then info "Done."; else warn "Could not prune old images (not critical)."; fi

# ---------------------------------------------------------------------------
step "Status"
"${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"

printf '\n\033[32mAI Studio is up.\033[0m\n'
echo "  App (UI + API gateway)  http://localhost:8080"
echo "  Frontend only           http://localhost:8081"
[ "$DEV" = 1 ] && echo "  Frontend hot-reload     http://localhost:5173"
echo "  API docs                http://localhost:8001/docs  (8002, 8003, 8004 for E2-E4)"
echo "  pgAdmin                 http://localhost:5055"
echo "  Adminer                 http://localhost:8085"
echo
echo "Run ./setup.sh again at any time to rebuild and replace the containers with up-to-date ones."
