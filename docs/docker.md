# Docker

La idea es que cualquiera que clone el repositorio tenga **exactamente el mismo
entorno**, sin instalar Python, PostgreSQL ni Kafka a mano.

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
cp .env.example .env
# generar un secreto de verdad
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
#   ↑ copialo a RECOP_SECRET_KEY en el .env

docker compose up
```

Eso levanta el nodo, PostgreSQL y Kafka. La API queda en
<http://localhost:7272/docs>.

---

## Los dos composes

| Archivo | Qué levanta | Cuándo |
|---|---|---|
| `docker-compose.yml` | Nodo + PostgreSQL + Kafka | Para correr todo containerizado, igual que en producción |
| `docker-compose.dev.yml` | Solo PostgreSQL + Kafka | Para desarrollar: la API corre en tu máquina y recarga al guardar |

Para desarrollar:

```bash
docker compose -f docker-compose.dev.yml up -d
make migrate
make api          # corre en tu máquina, con recarga
```

---

## Imagen multi-arquitectura

La imagen base está fijada **por digest**, y es el digest del índice
multi-arquitectura, no el de una plataforma. Por eso el mismo build produce la
imagen correcta en cada máquina:

| Plataforma | Qué la usa |
|---|---|
| `linux/amd64` | PC Intel/AMD, Windows con Docker Desktop, Mac Intel |
| `linux/arm64/v8` | Apple Silicon, Android 64-bit (Termux) |
| `linux/arm/v7` | Android 32-bit, Raspberry Pi |
| `linux/386` | x86 de 32 bits |
| `linux/ppc64le` | Raspberry Pi viejo, algunos SBC |

Para construirlas todas de una:

```bash
docker buildx create --use --name recap   # solo una vez
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t gonnnzadev/recop:0.1.0 \
  --push .
```

> Android no corre Docker nativo. La vía es **Termux**, que sí corre containers
> en Android 7 en adelante. Los scripts de instalación lo tienen en cuenta.

---

## Qué hace la imagen

**Multi-stage.** La primera etapa compila las dependencias con `uv`; la segunda
copia solo el resultado. La imagen final no lleva ni el compilador, ni `uv`, ni
el código fuente que ya no se usa.

**Usuario sin privilegios.** Corre como `recap` (uid 1001). Un nodo es un proceso
que vive en la PC de alguien; no debería poder escribir en `/usr` ni crear
usuarios.

**`tini` como PID 1.** Sin él, `SIGTERM` no llega a Uvicorn y cada
`docker compose restart` tarda 10 segundos. Con `tini`, la señal llega, Uvicorn
cierra las conexiones WebSocket y el container sale limpio.

**Migraciones.** El entrypoint espera a que PostgreSQL responda y después corre
`alembic upgrade head`. Es necesario: en Docker la API y la base arrancan a la
vez, y PostgreSQL tarda unos segundos en aceptar conexiones.

```
==> esperando a la base de datos (timeout: 60s)
    base de datos lista (postgres:5432/recop)
==> aplicando migraciones
==> arrancando el nodo
```

Si tenés varias réplicas del mismo nodo, poné `RECOP_AUTO_MIGRATE=false` en
todas menos una, o se pisan entre ellas.

---

## Configuración

Se hace por variables de entorno, no por archivo. El `.env` lo lee el compose.

| Variable | Para qué | Default |
|---|---|---|
| `RECOP_SECRET_KEY` | Firma los tokens. **Obligatoria en producción.** | — |
| `RECOP_PUBLISH_HOST` | Interfaz donde se publica el puerto | `0.0.0.0` |
| `RECOP_PUBLISH_PORT` | Puerto publicado en tu máquina | `7272` |
| `RECOP_AUTO_MIGRATE` | Aplicar migraciones al arrancar | `true` |
| `RECOP_ENV` | `local` \| `test` \| `prod` | `prod` en la imagen |
| `RECOP_DATABASE_URL` | Conexión a PostgreSQL | apunta a `postgres:5432` |

Si falta `RECOP_SECRET_KEY`, el compose falla con:

```
RECOP_SECRET_KEY: definí RECOP_SECRET_KEY en tu .env
```

Es intencional: es preferible no arrancar a arrancar con el secreto de ejemplo
del `.env.example`.

---

## Comandos útiles

```bash
docker compose up -d              # levanta en background
docker compose logs -f api        # sigue los logs del nodo
docker compose ps                 # estado y salud
docker compose exec api python -m core.cli --help
docker compose down               # para, conserva los datos
docker compose down -v            # para y BORRA los volúmenes
docker compose exec postgres psql -U recap -d recop   # entrar a la base
```

Los datos viven en los volúmenes `postgres_data` y `kafka_data`. `down` los
conserva; `down -v` los borra.

---

## Problemas frecuentes

**El puerto ya está ocupado**

```bash
RECOP_PUBLISH_PORT=8080 docker compose up
```

**`permission denied` al montar volúmenes**

No debería pasar en Linux; en Docker Desktop, revisá que el proyecto esté en una
ruta que Docker tenga acceso.

**El nodo reinicia en bucle**

Casi siempre es que no puede conectarse a la base. Mirá:

```bash
docker compose logs api
```

Si dice `la base de datos no respondió`, el problema está en `postgres`, no en
Recop.

**No me entra nadie desde la red local**

`RECOP_PUBLISH_HOST` tiene que ser `0.0.0.0`, no `127.0.0.1`. Y el firewall del
sistema tiene que dejar pasar el puerto.