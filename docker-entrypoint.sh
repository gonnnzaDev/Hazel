#!/bin/sh
# Hazel container entrypoint.
#
# It does two things and then becomes the API process:
#   1. Waits for PostgreSQL to be ready.
#   2. Applies the migrations.
#
# Both can be disabled with HAZEL_AUTO_MIGRATE=false, which is what you want
# in a deployment with several replicas of the same node: if they all run
# migrations at startup, they step on each other.

set -eu

HAZEL_AUTO_MIGRATE="${HAZEL_AUTO_MIGRATE:-true}"
MIGRATE_TIMEOUT="${HAZEL_MIGRATE_TIMEOUT:-60}"

if [ "$HAZEL_AUTO_MIGRATE" = "true" ]; then
    echo "==> waiting for the database (timeout: ${MIGRATE_TIMEOUT}s)"
    if ! python -m core.wait_for_db --timeout "$MIGRATE_TIMEOUT"; then
        echo "!! the database did not respond in time" >&2
        exit 1
    fi

    echo "==> applying migrations"
    alembic upgrade head
fi

echo "==> starting the node"
# exec replaces this shell with Uvicorn: so PID 1 is the server and receives
# signals directly. tini, which runs ahead in the ENTRYPOINT, takes care
# of forwarding them and reaping zombies.
exec python -m core "$@"