<#
.SYNOPSIS
  One-command setup for AI Studio: installs dependencies, rebuilds the Docker images,
  replaces the old containers with fresh ones and waits until everything is healthy.

.EXAMPLE
  .\setup.ps1                # full setup / update (keeps database data)
  .\setup.ps1 -NoCache       # rebuild images from scratch
  .\setup.ps1 -SkipLocal     # Docker only (no local npm / Python install)
  .\setup.ps1 -Dev           # also start the hot-reload frontend on :5173
  .\setup.ps1 -ResetData     # DELETE all database data and start clean (asks for confirmation)
#>
[CmdletBinding()]
param(
    [switch]$NoCache,
    [switch]$SkipLocal,
    [switch]$Dev,
    [switch]$ResetData,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$Project = 'ai-studio'   # must match "name:" in docker-compose.yml

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" }
function Warn($msg) { Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ""; Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }
function Run {
    # Runs a native command and stops the script if it fails.
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "Command failed ($LASTEXITCODE): $Exe $($Arguments -join ' ')" }
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Probe {
    # Runs a native command silently and returns its exit code. Windows PowerShell 5.1 turns redirected
    # stderr into terminating errors when ErrorActionPreference is 'Stop', so relax it for the probe.
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $Exe @Arguments *> $null; return $LASTEXITCODE } catch { return 1 } finally { $ErrorActionPreference = $prev }
}

# ---------------------------------------------------------------------------
Step "Checking prerequisites"
if (-not (Has 'docker')) { Fail "Docker is not installed. Install Docker Desktop: https://docs.docker.com/desktop/" }
if ((Probe 'docker' @('info')) -ne 0) { Fail "Docker is installed but not running. Start Docker Desktop and run this script again." }
if ((Probe 'docker' @('compose', 'version')) -ne 0) { Fail "Docker Compose v2 is required ('docker compose'). Update Docker Desktop." }
Info "Docker and Docker Compose are available."

# ---------------------------------------------------------------------------
Step "Environment file"
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Info "Created .env from .env.example (edit it to change passwords or ports)."
} else {
    Info ".env already exists, keeping it."
}

# ---------------------------------------------------------------------------
if ($SkipLocal) {
    Step "Local dependencies: skipped (-SkipLocal)"
} else {
    Step "Installing local dependencies (for development, tests and the editor)"
    if (Has 'npm') {
        # 'npm ci' wipes node_modules, which fails while a dev server or editor holds a file open:
        # use it only for a fresh install, otherwise 'npm install' (follows the lockfile, touches only what changed).
        $npmCmd = if (Test-Path 'node_modules') { 'install' } else { 'ci' }
        Info "npm $npmCmd (frontend workspace)..."
        & npm $npmCmd --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Warn "npm $npmCmd failed (is 'npm run dev' or an editor locking node_modules?). Continuing with Docker." }
    } else {
        Warn "npm not found: skipping frontend dependencies (Docker builds the frontend anyway). Install Node 22 to develop locally."
    }

    $py = $null
    foreach ($c in @('python', 'py', 'python3')) { if (Has $c) { $py = $c; break } }
    if ($py) {
        $venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
        if (-not (Test-Path $venvPy)) {
            Info "Creating Python virtual environment in .venv ..."
            & $py -m venv .venv
        }
        if (Test-Path $venvPy) {
            Info "Installing backend requirements into .venv ..."
            $reqs = Get-ChildItem -Path 'services' -Filter 'requirements.txt' -Recurse | ForEach-Object { @('-r', $_.FullName) }
            & $venvPy -m pip install --quiet --disable-pip-version-check @reqs
            if ($LASTEXITCODE -eq 0) { Info "Backend tests: .venv\Scripts\python -m pytest tests" }
            else { Warn "pip install failed. Continuing with Docker." }
        } else {
            Warn "Could not create .venv. Continuing with Docker."
        }
    } else {
        Warn "Python not found: skipping backend test dependencies (the services run in Docker anyway)."
    }
}

# ---------------------------------------------------------------------------
$composeArgs = @('compose', '-p', $Project)
if ($Dev) { $composeArgs += @('--profile', 'dev') }

Step "Pulling the latest base images (postgres, pgadmin, adminer)"
& docker @composeArgs pull --ignore-buildable --quiet
if ($LASTEXITCODE -ne 0) { Warn "Could not pull newer images (offline?). Using the ones already downloaded." }

Step "Building images$(if ($NoCache) { ' from scratch (-NoCache)' })"
$buildArgs = $composeArgs + @('build', '--pull')
if ($NoCache) { $buildArgs += '--no-cache' }
& docker @buildArgs
if ($LASTEXITCODE -ne 0) {
    # Usually a network/registry hiccup while checking for newer base images: retry with the cached ones.
    # Nothing has been stopped yet, so the running containers are untouched either way.
    Warn "Build with fresh base images failed (network or Docker Hub unreachable?). Retrying with locally cached base images..."
    Run 'docker' ($buildArgs | Where-Object { $_ -ne '--pull' })
}

if ($ResetData) {
    Step "Reset requested: ALL database data (Postgres, pgAdmin) will be deleted"
    if (-not $Yes) {
        $answer = Read-Host "    Type 'yes' to confirm"
        if ($answer -ne 'yes') { Fail "Reset cancelled." }
    }
}

Step "Removing old containers"
$downArgs = $composeArgs + @('down', '--remove-orphans')
if ($ResetData) { $downArgs += '--volumes' }
Run 'docker' $downArgs

Step "Starting fresh containers and waiting until they are healthy"
Run 'docker' ($composeArgs + @('up', '-d', '--force-recreate', '--remove-orphans', '--wait', '--wait-timeout', '240'))

Step "Cleaning up old images replaced by this build"
if ((Probe 'docker' @('image', 'prune', '-f', '--filter', "label=com.docker.compose.project=$Project")) -eq 0) { Info "Done." }
else { Warn "Could not prune old images (not critical)." }

# ---------------------------------------------------------------------------
Step "Status"
& docker @composeArgs ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"

Write-Host ""
Write-Host "AI Studio is up." -ForegroundColor Green
Write-Host "  App (UI + API gateway)  http://localhost:8080"
Write-Host "  Frontend only           http://localhost:8081"
if ($Dev) { Write-Host "  Frontend hot-reload     http://localhost:5173" }
Write-Host "  API docs                http://localhost:8001/docs  (8002, 8003, 8004 for E2-E4)"
Write-Host "  pgAdmin                 http://localhost:5055"
Write-Host "  Adminer                 http://localhost:8085"
Write-Host ""
Write-Host "Run .\setup.ps1 again at any time to rebuild and replace the containers with up-to-date ones."
