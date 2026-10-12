#!/bin/sh
# Entrypoint del container de Recop.
#
# Hace dos cosas y después se convierte en el proceso de la API:
#   1. Espera a que PostgreSQL esté listo.
#   2. Aplica las migraciones.
#
# Ambas se pueden desactivar con RECOP_AUTO_MIGRATE=false, que es lo que hay que
# hacer en un despliegue con varias réplicas del mismo nodo: si todas corren
# migraciones al arrancar, se pisan entre ellas.

set -eu

RECOP_AUTO_MIGRATE="${RECOP_AUTO_MIGRATE:-true}"
MIGRATE_TIMEOUT="${RECOP_MIGRATE_TIMEOUT:-60}"

if [ "$RECOP_AUTO_MIGRATE" = "true" ]; then
    echo "==> esperando a la base de datos (timeout: ${MIGRATE_TIMEOUT}s)"
    if ! python -m core.wait_for_db --timeout "$MIGRATE_TIMEOUT"; then
        echo "!! la base de datos no respondió a tiempo" >&2
        exit 1
    fi

    echo "==> aplicando migraciones"
    alembic upgrade head
fi

echo "==> arrancando el nodo"
# exec reemplaza este shell por Uvicorn: así PID 1 es el servidor y recibe las
# señales directamente. tini, que está por delante en el ENTRYPOINT, se encarga
# de reenviar y de eliminar zombies.
exec python -m core "$@"