#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recop — comandos de uso diario
#
#     ./scripts/recop.sh <comando>
#
# Es el equivalente del Makefile para quien no tiene make (Windows, Android,
# o simplemente quien no lo tenga instalado). Cada comando hace lo mismo que su
# target del Makefile, así que los dos sirven.
#
#     ./scripts/recop.sh up        # levantar PostgreSQL y Kafka
#     ./scripts/recop.sh api       # arrancar el nodo
#     ./scripts/recop.sh check     # lint + formato + tipos + tests
#     ./scripts/recop.sh help      # ver todos los comandos
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

COMPOSE="docker compose -f docker-compose.dev.yml"
STACK="docker compose"

need_docker() {
    if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
        printf 'docker no está disponible.\n' >&2
        # $USER y $PREFIX van literales: son parte del comando que el usuario
        # tiene que copiar y pegar, no algo que queramos expandir acá.
        # shellcheck disable=SC2016
        printf '  Linux:     sudo usermod -aG docker $USER  (y volvé a iniciar sesión)\n' >&2
        printf '  macOS:     abrí Docker Desktop\n' >&2
        printf '  Windows:   abrí Docker Desktop\n' >&2
        printf '  Android:   instalá el paquete docker en Termux\n' >&2
        exit 1
    fi
}

wait_for_postgres() {
    local user="recop"
    if [ -f .env ]; then
        user="$(awk -F= '/^POSTGRES_USER=/ {print $2}' .env | head -1)"
        [ -n "$user" ] || user="recop"
    fi
    printf '    esperando a PostgreSQL...'
    for _ in $(seq 1 60); do
        if $COMPOSE exec -T postgres pg_isready -U "$user" >/dev/null 2>&1; then
            printf ' listo\n'
            return 0
        fi
        sleep 1
    done
    printf ' no respondió\n' >&2
    return 1
}

cmd_up() {
    need_docker
    $COMPOSE up -d
    wait_for_postgres
}

cmd_down()     { need_docker; $COMPOSE down; }
cmd_reset()    { need_docker; $COMPOSE down -v; }
cmd_logs()     { need_docker; $COMPOSE logs -f; }
cmd_stack_up() { need_docker; $STACK up -d --build; }
cmd_stack_down(){ need_docker; $STACK down; }
cmd_stack_logs(){ need_docker; $STACK logs -f api; }

cmd_api()        { uv run python -m core --reload; }
cmd_migrate()    { uv run alembic upgrade head; }
cmd_downgrade()  { uv run alembic downgrade "${1:--1}"; }

cmd_revision() {
    if [ -z "${1:-}" ]; then
        printf 'uso: ./scripts/recop.sh revision "mensaje"\n' >&2
        exit 1
    fi
    uv run alembic revision --autogenerate -m "$1"
}

cmd_lint()      { uv run ruff check .; }
cmd_format()    { uv run ruff format .; }
cmd_typecheck() { uv run mypy apps core; }
cmd_test()      { uv run pytest "$@"; }

cmd_test_integration() {
    if [ -z "${RECOP_TEST_DATABASE_URL:-}" ]; then
        printf 'Falta RECOP_TEST_DATABASE_URL. Ej:\n' >&2
        printf '  ./scripts/recop.sh test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test\n' >&2
        exit 1
    fi
    uv run pytest "$@"
}

cmd_check() {
    cmd_lint && cmd_format && cmd_typecheck && cmd_test
}

cmd_health() {
    port="$(awk -F= '/^RECOP_PORT=/ {print $2}' .env 2>/dev/null | head -1)"
    port="${port:-7272}"
    printf 'salud del nodo en localhost:%s\n\n' "$port"
    curl -sS "http://localhost:${port}/health" && printf '\n\n' || printf 'el nodo no responde en el puerto %s\n' "$port"
    curl -sS "http://localhost:${port}/health/ready" && printf '\n' || printf 'el nodo no responde en el puerto %s\n' "$port"
}

cmd_help() {
    cat <<'EOF'
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

  Otros
    help              Esta ayuda

Ejemplos
    ./scripts/recop.sh up
    ./scripts/recop.sh test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test
EOF
}

main() {
    local cmd="${1:-help}"
    shift || true

    case "$cmd" in
        up)               cmd_up ;;
        down)             cmd_down ;;
        reset)            cmd_reset ;;
        logs)             cmd_logs ;;
        stack-up)         cmd_stack_up ;;
        stack-down)       cmd_stack_down ;;
        stack-logs)       cmd_stack_logs ;;
        api)              cmd_api ;;
        migrate)          cmd_migrate ;;
        downgrade)        cmd_downgrade "$@" ;;
        revision)         cmd_revision "$@" ;;
        lint)             cmd_lint ;;
        format)           cmd_format ;;
        typecheck)        cmd_typecheck ;;
        test)             cmd_test "$@" ;;
        test-integration) cmd_test_integration "$@" ;;
        check)            cmd_check ;;
        health)           cmd_health ;;
        help|-h|--help)   cmd_help ;;
        *)
            printf 'comando desconocido: %s\n\n' "$cmd" >&2
            cmd_help >&2
            exit 1
            ;;
    esac
}

main "$@"