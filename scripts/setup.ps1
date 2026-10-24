<#
.SYNOPSIS
    Hazel — Windows installation.

.DESCRIPTION
    Equivalent to scripts/setup.sh, in PowerShell.

    Covers Windows 10 and 11 with PowerShell 5.1 (the one shipping with Windows)
    and PowerShell 7+.

    What it does, in order:
      1. Checks the bare minimum
      2. Installs uv if missing (uv brings its own Python)
      3. Installs the exact dependencies pinned in uv.lock
      4. Creates the .env with a generated secret
      5. Starts PostgreSQL and Kafka with Docker, if Docker is available

    It is idempotent: running it twice breaks nothing.

.EXAMPLE
    .\scripts\setup.ps1

.NOTES
    If PowerShell blocks script execution:
        powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
#>

#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

# ─── Presentation ─────────────────────────────────────────────────────────────

$UseColor = -not $env:NO_COLOR -and $Host.UI.SupportsVirtualTerminal

function Write-Step { param([string]$Message)
    if ($UseColor) { Write-Host "`n==> $Message" -ForegroundColor Blue }
    else { Write-Host "`n==> $Message" }
}
function Write-Ok { param([string]$Message)
    if ($UseColor) { Write-Host "    OK $Message" -ForegroundColor Green }
    else { Write-Host "    OK $Message" }
}
function Write-Info { param([string]$Message)
    if ($UseColor) { Write-Host "    $Message" -ForegroundColor DarkGray }
    else { Write-Host "    $Message" }
}
function Write-Warn { param([string]$Message)
    if ($UseColor) { Write-Host "    ! $Message" -ForegroundColor Yellow }
    else { Write-Host "    ! $Message" }
}
function Die { param([string]$Message)
    Write-Host "`nerror: $Message" -ForegroundColor Red
    exit 1
}

# ─── 1. Platform ────────────────────────────────────────────────────────────

Write-Step "Detecting the platform"

# Windows on ARM runs the same linux/arm64 container images via
# Docker Desktop; the host is still Windows.
$Arch = $env:PROCESSOR_ARCHITECTURE
Write-Ok "windows / $Arch"

if ($Arch -eq "ARM64") {
    Write-Info "you will need Docker Desktop in Windows containers mode."
}

# ─── 2. Prerequisites ────────────────────────────────────────────────────────

Write-Step "Checking the bare minimum"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Die "you need Git for Windows. Get it from https://git-scm.com/download/win and run again."
}
Write-Info "git OK"

# ─── 3. uv ────────────────────────────────────────────────────────────────────

function Install-Uv {
    Write-Info "installing uv..."

    # The official installer detects Windows and uses the .exe installer.
    $installer = Join-Path $env:TEMP "uv-installer.ps1"
    try {
        Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -OutFile $installer -UseBasicParsing
        & powershell -ExecutionPolicy ByPass -File $installer | Out-Null
    } catch {
        return $false
    } finally {
        Remove-Item $installer -ErrorAction SilentlyContinue
    }

    $uvDir = Join-Path $env:USERPROFILE ".local\bin"
    if (Test-Path $uvDir) {
        $env:PATH = "$uvDir;$env:PATH"
    }

    return [bool](Get-Command uv -ErrorAction SilentlyContinue)
}

Write-Step "Installing uv (the dependency manager)"
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $v = (& uv --version) -split ' ' | Select-Object -Last 1
    Write-Ok "uv $v"
} else {
    if (-not (Install-Uv)) {
        Die "could not install uv. Get it from https://docs.astral.sh/uv/getting-started/installation/"
    }
    $v = (& uv --version) -split ' ' | Select-Object -Last 1
    Write-Ok "uv $v"
}

Write-Info "uv brings its own Python, so you don't need Python installed."

# ─── 4. Dependencies ──────────────────────────────────────────────────────────

Write-Step "Installing dependencies"

# uv sync uses uv.lock: an exact list of versions. Everyone running this
# script installs the same thing, no matter when they run it.
Push-Location $ProjectDir
try {
    & uv sync --locked 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) {
        Die "dependency installation failed. Check the error above."
    }
    Write-Ok "dependencies installed (exact, from uv.lock)"
} finally {
    Pop-Location
}

# ─── 5. Configuration ─────────────────────────────────────────────────────────

Write-Step "Preparing configuration"

if (Test-Path ".env") {
    Write-Ok ".env already exists, leaving it alone"
} else {
    # Compose fails on purpose when HAZEL_SECRET_KEY is missing. We generate a
    # real one so the first start works with no extra steps.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $Secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

    $adminBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($adminBytes)
    $AdminToken = [Convert]::ToBase64String($adminBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

    # Defaults mirroring src/config/conf.py: the only thing that must be unique
    # per install is the secret.
    $content = @(
        "# Hazel — local configuration (generated by setup.ps1; NEVER commit).",
        "HAZEL_ENV=local",
        "HAZEL_DEBUG=true",
        "HAZEL_SECRET_KEY=$Secret",
        "# Token required to create, edit, activate, deactivate or delete servers.",
        "HAZEL_ADMIN_TOKEN=$AdminToken",
        "",
        "HAZEL_PUBLISH_HOST=0.0.0.0",
        "HAZEL_PUBLISH_PORT=7272",
        "",
        "POSTGRES_USER=hazel",
        "POSTGRES_PASSWORD=hazel",
        "POSTGRES_DB=hazel",
        "POSTGRES_PORT=5432",
        "",
        "KAFKA_EXTERNAL_PORT=9092",
        "",
        "HAZEL_AUTO_MIGRATE=true",
        "",
        "HAZEL_HOST=0.0.0.0",
        "HAZEL_PORT=7272",
        "# Last port the node may assign to a group process.",
        "HAZEL_GROUP_PORT_END=7400",
        "HAZEL_ROOT_PATH=",
        "HAZEL_CORS_ORIGINS=*",
        "",
        "HAZEL_DATABASE_URL=postgresql+asyncpg://hazel:hazel@localhost:5432/hazel",
        "HAZEL_DB_POOL_SIZE=10",
        "HAZEL_DB_MAX_OVERFLOW=20",
        "HAZEL_DB_ECHO=false",
        "",
        "HAZEL_KAFKA_BOOTSTRAP_SERVERS=localhost:9092",
        "HAZEL_KAFKA_TOPIC_PREFIX=hazel",
        "HAZEL_KAFKA_CLIENT_ID=",
        "HAZEL_KAFKA_MAX_POLL_RECORDS=500",
        "",
        "HAZEL_RATE_LIMIT_MESSAGES_PER_MINUTE=20",
        "HAZEL_MAX_MESSAGE_BYTES=4000"
    )
    # Set-Content writes UTF-8 without BOM since PowerShell 5.1 with -Encoding UTF8.
    $content | Set-Content ".env" -Encoding UTF8

    Write-Ok ".env created with a generated secret"
}

# ─── 6. Docker ────────────────────────────────────────────────────────────────

Write-Step "Looking for Docker"

$HaveDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        $HaveDocker = $true
        $dv = & docker version --format "{{.Server.Version}}"
        Write-Ok "docker $dv"
    } else {
        Write-Warn "docker is installed but the daemon is not responding."
        Write-Warn "Open Docker Desktop and run this script again."
    }
} else {
    Write-Warn "no Docker found."
    Write-Warn "Get it from https://www.docker.com/products/docker-desktop/"
}

if ($HaveDocker) {
    Write-Step "Starting PostgreSQL and Kafka"
    & docker compose -f docker-compose.dev.yml up -d 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -eq 0) {
        Write-Info "waiting for PostgreSQL to respond..."
        $User = "hazel"
        foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
            if ($line -match '^POSTGRES_USER=(.*)$') { $User = $Matches[1]; break }
        }
        for ($i = 0; $i -lt 30; $i++) {
            & docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U $User *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
        }
        Write-Ok "PostgreSQL and Kafka are up"

        Write-Step "Applying migrations"
        & uv run alembic upgrade head 2>&1 | ForEach-Object { Write-Info $_ }
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "database ready"
        } else {
            Write-Warn "migrations failed. Run 'uv run alembic upgrade head' once the database is up."
        }
    } else {
        Write-Warn "could not start the services."
    }
}

# ─── 7. Listo ─────────────────────────────────────────────────────────────────

$Port = "7272"
foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
    if ($line -match '^HAZEL_PORT=(\d+)$') { $Port = $Matches[1]; break }
}

$Bold = if ($UseColor) { "`e[1m" } else { "" }
$Reset = if ($UseColor) { "`e[0m" } else { "" }
$Green = if ($UseColor) { "`e[32m" } else { "" }
$Dim = if ($UseColor) { "`e[2m" } else { "" }

Write-Host @"

$Green$Bold`Done.$Reset

  ${Bold}Start the node$Reset
    uv run python -m core

  ${Bold}Admin token$Reset
    Saved as HAZEL_ADMIN_TOKEN in .env. Send it as
    Authorization: Bearer <token> on server management endpoints.

  Then, in another terminal:

    ${Dim}curl localhost:$Port/docs$Reset        the documented API
    ${Dim}curl localhost:$Port/api/v1/node$Reset   the address to share

  ${Bold}Without Docker${Reset}: point HAZEL_DATABASE_URL and HAZEL_KAFKA_BOOTSTRAP_SERVERS
  in the .env to databases you already have, and run the migrations.

  ${Bold}The four states of a server$Reset
    Off or down  → port closed, data intact
    On           → port open, data intact
    Deleted      → port closed, data deleted

  ${Bold}Help$Reset
    .\scripts\hazel.ps1 help      list the commands

"@