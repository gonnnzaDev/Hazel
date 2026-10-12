<#
.SYNOPSIS
    Recop — instalación para Windows.

.DESCRIPTION
    Equivalentee a scripts/setup.sh, en PowerShell.

    Cubre Windows 10 y 11 con PowerShell 5.1 (el que viene con Windows) y
    PowerShell 7+.

    Qué hace, en orden:
      1. Chequea que falte lo mínimo
      2. Instala uv si no está (uv trae su propio Python)
      3. Instala las dependencias exactas que define uv.lock
      4. Crea el .env con un secreto generado
      5. Levanta PostgreSQL y Kafka con Docker, si hay Docker

    Es idempotente: correrlo dos veces no rompe nada.

.EXAMPLE
    .\scripts\setup.ps1

.NOTES
    Si PowerShell bloquea la ejecución de scripts:
        powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
#>

#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

# ─── Presentación ─────────────────────────────────────────────────────────────

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

# ─── 1. Plataforma ────────────────────────────────────────────────────────────

Write-Step "Detectando la plataforma"

# Windows en ARM corre las mismas imágenes linux/arm64 del contenedor vía
# Docker Desktop; el host igual es Windows.
$Arch = $env:PROCESSOR_ARCHITECTURE
Write-Ok "windows / $Arch"

if ($Arch -eq "ARM64") {
    Write-Info "vas a necesitar Docker Desktop en modo Windows containers."
}

# ─── 2. Prerrequisitos ────────────────────────────────────────────────────────

Write-Step "Chequeando lo mínimo"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Die "necesitás Git para Windows. Bajalo de https://git-scm.com/download/win y volvé a correr."
}
Write-Info "git OK"

# ─── 3. uv ────────────────────────────────────────────────────────────────────

function Install-Uv {
    Write-Info "instalando uv..."

    # El instalador oficial detecta Windows y usa el instalador .exe.
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

Write-Step "Instalando uv (el gestor de dependencias)"
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $v = (& uv --version) -split ' ' | Select-Object -Last 1
    Write-Ok "uv $v"
} else {
    if (-not (Install-Uv)) {
        Die "no pude instalar uv. Bajalo de https://docs.astral.sh/uv/getting-started/installation/"
    }
    $v = (& uv --version) -split ' ' | Select-Object -Last 1
    Write-Ok "uv $v"
}

Write-Info "uv trae su propio Python, así que no hace falta que tengas Python instalado."

# ─── 4. Dependencias ──────────────────────────────────────────────────────────

Write-Step "Instalando las dependencias"

# uv sync usa uv.lock: lista exacta de versiones. Todos los que corran este
# script instalan lo mismo, sin importar cuándo lo corren.
Push-Location $ProjectDir
try {
    & uv sync --locked 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) {
        Die "falló la instalación de dependencias. Revisá el error de arriba."
    }
    Write-Ok "dependencias instaladas (exactas, desde uv.lock)"
} finally {
    Pop-Location
}

# ─── 5. Configuración ─────────────────────────────────────────────────────────

Write-Step "Preparando la configuración"

if (Test-Path ".env") {
    Write-Ok ".env ya existe, no lo toco"
} else {
    # El compose falla a propósito si RECOP_SECRET_KEY no esta. Generamos una de
    # verdad para que el primer arranque funcione sin pasos extra.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $Secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

    $content = Get-Content ".env.example"
    $content = $content | ForEach-Object {
        if ($_ -match '^RECOP_SECRET_KEY=') { "RECOP_SECRET_KEY=$Secret" } else { $_ }
    }
    # Set-Content escribe en UTF-8 sin BOM desde PowerShell 5.1 con -Encoding UTF8.
    $content | Set-Content ".env" -Encoding UTF8

    Write-Ok ".env creado con un secreto generado"
}

# ─── 6. Docker ────────────────────────────────────────────────────────────────

Write-Step "Buscando Docker"

$HaveDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        $HaveDocker = $true
        $dv = & docker version --format "{{.Server.Version}}"
        Write-Ok "docker $dv"
    } else {
        Write-Warn "docker está instalado pero el daemon no responde."
        Write-Warn "Abrí Docker Desktop y volvé a correr este script."
    }
} else {
    Write-Warn "no encontré Docker."
    Write-Warn "Bajalo de https://www.docker.com/products/docker-desktop/"
}

if ($HaveDocker) {
    Write-Step "Levantando PostgreSQL y Kafka"
    & docker compose -f docker-compose.dev.yml up -d 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -eq 0) {
        Write-Info "esperando a que PostgreSQL responda..."
        $User = "recop"
        foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
            if ($line -match '^POSTGRES_USER=(.*)$') { $User = $Matches[1]; break }
        }
        for ($i = 0; $i -lt 30; $i++) {
            & docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U $User *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
        }
        Write-Ok "PostgreSQL y Kafka levantados"

        Write-Step "Aplicando migraciones"
        & uv run alembic upgrade head 2>&1 | ForEach-Object { Write-Info $_ }
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "base de datos lista"
        } else {
            Write-Warn "fallaron las migraciones. Corré 'uv run alembic upgrade head' cuando la base esté arriba."
        }
    } else {
        Write-Warn "no pude levantar los servicios."
    }
}

# ─── 7. Listo ─────────────────────────────────────────────────────────────────

$Port = "7272"
foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
    if ($line -match '^RECOP_PORT=(\d+)$') { $Port = $Matches[1]; break }
}

$Bold = if ($UseColor) { "`e[1m" } else { "" }
$Reset = if ($UseColor) { "`e[0m" } else { "" }
$Green = if ($UseColor) { "`e[32m" } else { "" }
$Dim = if ($UseColor) { "`e[2m" } else { "" }

Write-Host @"

$Green$Bold`Listo.$Reset

  ${Bold}Arrancar el nodo$Reset
    uv run python -m core

  Y despues, en otra terminal:

    ${Dim}curl localhost:$Port/docs$Reset        la API documentada
    ${Dim}curl localhost:$Port/api/v1/node$Reset   la dirección para compartir

  ${Bold}Sin Docker${Reset}: apuntá RECOP_DATABASE_URL y RECOP_KAFKA_BOOTSTRAP_SERVERS
  en el .env a unas bases de datos que ya tengas, y corré las migraciones.

  ${Bold}Los cuatro estados de un servidor$Reset
    Apagado o caído  → puerto cerrado, datos intactos
    Encendido        → puerto abierto, datos intactos
    Eliminado        → puerto cerrado, datos borrados

  ${Bold}Ayuda$Reset
    .\scripts\recop.ps1 help      lista los comandos

"@