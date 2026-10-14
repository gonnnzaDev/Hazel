<#
.SYNOPSIS
    Hazel — everyday commands for Windows.

.DESCRIPTION
    Equivalent to scripts/hazel.sh and the Makefile, for Windows.

        .\scripts\hazel.ps1 <command>

    Each command does the same as its Makefile target, so all three work.

.EXAMPLE
    .\scripts\hazel.ps1 up

.NOTES
    If PowerShell blocks script execution:
        powershell -ExecutionPolicy Bypass -File .\scripts\hazel.ps1 up
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
        Write-Host "docker is not available." -ForegroundColor Red
        Write-Host "  Windows: open Docker Desktop and try again." -ForegroundColor Red
        exit 1
    }
}

function Wait-ForPostgres {
    $user = "hazel"
    if (Test-Path ".env") {
        foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
            if ($line -match '^POSTGRES_USER=(.*)$') { $user = $Matches[1]; break }
        }
    }
    Write-Host "    waiting for PostgreSQL..." -ForegroundColor DarkGray -NoNewline
    for ($i = 0; $i -lt 60; $i++) {
        & docker @Compose exec -T postgres pg_isready -U $user *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " ready" -ForegroundColor DarkGray
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Host " did not respond" -ForegroundColor Red
    return $false
}

# ─── Commands ─────────────────────────────────────────────────────────────────

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
            Write-Host 'usage: .\scripts\hazel.ps1 revision "message"' -ForegroundColor Red
            exit 1
        }
        & uv run alembic revision --autogenerate -m $Rest[0]
    }

    "lint"      { & uv run ruff check . }
    "format"    { & uv run ruff format . }
    "typecheck" { & uv run mypy apps core }
    "test"      { & uv run pytest @Rest }
    "test-integration" {
        if (-not $env:HAZEL_TEST_DATABASE_URL) {
            Write-Host "Missing HAZEL_TEST_DATABASE_URL. E.g.:" -ForegroundColor Red
            Write-Host '  .\scripts\hazel.ps1 test-integration postgresql+asyncpg://hazel:hazel@localhost:5432/hazel_test' -ForegroundColor Red
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
                if ($line -match '^HAZEL_PORT=(\d+)$') { $port = $Matches[1]; break }
            }
        }
        Write-Host "node health on localhost:$port`n"
        try {
            Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 5 | ConvertTo-Json -Depth 5
            Write-Host ""
            Invoke-RestMethod "http://localhost:$port/health/ready" -TimeoutSec 5 | ConvertTo-Json -Depth 5
        } catch {
            Write-Host "the node is not responding on port $port" -ForegroundColor Red
        }
    }

    { $_ -in @("help", "-h", "--help") } {
        Write-Host @"
Hazel — commands

  Development
    up                Start PostgreSQL and Kafka
    down              Stop them (keeping the data)
    reset             Stop them and delete the volumes (destructive)
    logs              Follow the service logs
    api               Start the node with reload
    migrate           Apply the migrations
    downgrade [rev]   Revert migrations (one by default)
    revision "msg"    Create an autogenerated migration

    lint              Lint
    format            Format
    typecheck         Type check
    test [args]       Run the tests
    test-integration  Tests against a real database
    check             lint + format + typecheck + test

    health            Ask the node how it is doing

  Full stack (everything in containers)
    stack-up          Start node + PostgreSQL + Kafka
    stack-down        Stop them
    stack-logs        Node logs

Examples
    .\scripts\hazel.ps1 up
    `$env:HAZEL_TEST_DATABASE_URL='postgresql+asyncpg://hazel:hazel@localhost:5432/hazel_test'
    .\scripts\hazel.ps1 test-integration
"@
    }

    default {
        Write-Host "unknown command: $Command" -ForegroundColor Red
        & $PSScriptRoot\hazel.ps1 help
        exit 1
    }
}