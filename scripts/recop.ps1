<#
.SYNOPSIS
    Recop — comandos de uso diario para Windows.

.DESCRIPTION
    Equivalentee a scripts/recop.sh y al Makefile, para Windows.

        .\scripts\recop.ps1 <comando>

    Cada comando hace lo mismo que su target del Makefile, así que los tres
    sirven.

.EXAMPLE
    .\scripts\recop.ps1 up

.NOTES
    Si PowerShell bloquea la ejecución de scripts:
        powershell -ExecutionPolicy Bypass -File .\scripts\recop.ps1 up
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Command = "help",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]] $Rest = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

$Compose = @("compose", "-f", "docker-compose.dev.yml")
$Stack = @("compose")

function Invoke-Compose {
    param([string[]] $ComposeArgs)
    & docker @ComposeArgs
    return $LASTEXITCODE
}

function Test-DockerAvailable {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    & docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

function Require-Docker {
    if (-not (Test-DockerAvailable)) {
        Write-Host "docker no está disponible." -ForegroundColor Red
        Write-Host "  Windows: abrí Docker Desktop y volvé a intentar." -ForegroundColor Red
        exit 1
    }
}

function Wait-ForPostgres {
    $user = "recop"
    if (Test-Path ".env") {
        foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
            if ($line -match '^POSTGRES_USER=(.*)$') { $user = $Matches[1]; break }
        }
    }
    Write-Host "    esperando a PostgreSQL..." -ForegroundColor DarkGray -NoNewline
    for ($i = 0; $i -lt 60; $i++) {
        & docker @Compose exec -T postgres pg_isready -U $user *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " listo" -ForegroundColor DarkGray
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Host " no respondió" -ForegroundColor Red
    return $false
}

# ─── Comandos ─────────────────────────────────────────────────────────────────

switch ($Command) {
    "up" {
        Require-Docker
        Invoke-Compose ($Compose + @("up", "-d"))
        Wait-ForPostgres | Out-Null
    }
    "down"   { Require-Docker; Invoke-Compose ($Compose + @("down")) | Out-Null }
    "reset"  { Require-Docker; Invoke-Compose ($Compose + @("down", "-v")) | Out-Null }
    "logs"   { Require-Docker; Invoke-Compose ($Compose + @("logs", "-f")) | Out-Null }

    "stack-up"   { Require-Docker; Invoke-Compose ($Stack + @("up", "-d", "--build")) | Out-Null }
    "stack-down" { Require-Docker; Invoke-Compose ($Stack + @("down")) | Out-Null }
    "stack-logs" { Require-Docker; Invoke-Compose ($Stack + @("logs", "-f", "api")) | Out-Null }

    "api"       { & uv run python -m core --reload }
    "migrate"   { & uv run alembic upgrade head }
    "downgrade" {
        $target = if ($Rest.Count -gt 0) { $Rest[0] } else { "-1" }
        & uv run alembic downgrade $target
    }
    "revision" {
        if ($Rest.Count -eq 0) {
            Write-Host 'uso: .\scripts\recop.ps1 revision "mensaje"' -ForegroundColor Red
            exit 1
        }
        & uv run alembic revision --autogenerate -m $Rest[0]
    }

    "lint"      { & uv run ruff check . }
    "format"    { & uv run ruff format . }
    "typecheck" { & uv run mypy apps core }
    "test"      { & uv run pytest @Rest }
    "test-integration" {
        if (-not $env:RECOP_TEST_DATABASE_URL) {
            Write-Host "Falta RECOP_TEST_DATABASE_URL. Ej:" -ForegroundColor Red
            Write-Host '  .\scripts\recop.ps1 test-integration postgresql+asyncpg://recop:recop@localhost:5432/recop_test' -ForegroundColor Red
            exit 1
        }
        & uv run pytest @Rest
    }
    "check" {
        & uv run ruff check .
        & uv run ruff format .
        & uv run mypy apps core
        & uv run pytest
    }

    "health" {
        $port = "7272"
        if (Test-Path ".env") {
            foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
                if ($line -match '^RECOP_PORT=(\d+)$') { $port = $Matches[1]; break }
            }
        }
        Write-Host "salud del nodo en localhost:$port`n"
        try {
            Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 5 | ConvertTo-Json -Depth 5
            Write-Host ""
            Invoke-RestMethod "http://localhost:$port/health/ready" -TimeoutSec 5 | ConvertTo-Json -Depth 5
        } catch {
            Write-Host "el nodo no responde en el puerto $port" -ForegroundColor Red
        }
    }

    { $_ -in @("help", "-h", "--help") } {
        Write-Host @"
Recop — comandos

  Desarrollo
    up                Levanta PostgreSQL y Kafka
    down              Los para (conservando los datos)
    reset             Los para y borra los volúmenes (destructivo)
    logs              Sigue los logs de los servicios
    api               Arranca el nodo con recarga
    migrate           Aplica las migraciones
    downgrade [rev]   Revierte migraciones (por defecto, una)
    revision "msg"    Crea una migración autogenerada

    lint              Lint
    format            Formatea
    typecheck         Chequeo de tipos
    test [args]       Corre los tests
    test-integration  Tests contra una base real
    check             lint + format + typecheck + test

    health            Le pregunta al nodo cómo está

  Stack completo (todo en containers)
    stack-up          Levanta nodo + PostgreSQL + Kafka
    stack-down        Los para
    stack-logs        Logs del nodo

Ejemplos
    .\scripts\recop.ps1 up
    `$env:RECOP_TEST_DATABASE_URL='postgresql+asyncpg://recop:recop@localhost:5432/recop_test'
    .\scripts\recop.ps1 test-integration
"@
    }

    default {
        Write-Host "comando desconocido: $Command" -ForegroundColor Red
        & $PSScriptRoot\recop.ps1 help
        exit 1
    }
}