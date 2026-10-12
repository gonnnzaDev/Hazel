# Recop

**Chat autoservido. Tu servidor, tu máquina, tu puerto.**

Recop es un backend de chat tipo Discord con una diferencia clave: **no hay una plataforma
central que hostee nada por vos**. Cada persona despliega su propio *servidor* en su propia PC,
se abre un puerto en su máquina, sus amigos se conectan a `host:puerto`, y cuando el dueño
decide cerrar el servidor, el puerto se cierra. Sin un corte global, sin dependencia de un
proveedor central.

> **Estado:** en construcción. Backend únicamente. Sin UI todavía.

---

## Cómo se usa (visión de producto)

1. Descargás/instalás el **nodo Recop** en tu PC.
2. Levantás tu servidor local → se abre un puerto (ej. `192.168.1.50:7272`).
3. Compartís `host:puerto` con quien quieras.
4. Cada persona entra con un **nickname**. No hay cuentas globales, no hay emails, no hay registro.
5. Cuando dejás de querer el servidor, lo apagás → el puerto se cierra y el servidor queda
   **inactivo**, conservando toda su información.

La identidad de una persona **existe únicamente dentro de un servidor**. El mismo nickname puede
existir en dos servidores distintos y son dos personas diferentes. Esto es intencional.

---

## Propuesta de valor

| | Plataforma central (Discord, Slack) | Recop |
|---|---|---|
| Quién hospeda | El proveedor | **Vos** |
| Coste de infraestructura | Escala con el uso | Escala con tu hardware |
| Si el proveedor cae | No entrás a ningún lado | **No aplica: no hay proveedor** |
| Tus datos | En sus servidores | **En tu máquina** |
| Silencio/ausencia | Sin impacto | Solo afecta a tu servidor |
| Puerto exposure | No lo controlás | **Lo controlás vos** |

---

## Arquitectura

Backend en **Python 3.13 + FastAPI**, organizado como una colección de *apps* al estilo Django
(cada app encapsula su propio modelo, esquema, servicio y API).

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Servidor A  │   │  Servidor B  │   │  Servidor C  │
│  (tu PC)     │   │  (tu PC)     │   │  (tu PC)     │
│  :7272       │   │  :8080       │   │  :9000       │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │            Kafka (bus de chat)      │
       └──────────────────┼──────────────────┘
                          │
                  ┌───────┴────────┐
                  │  PostgreSQL    │
                  │  (por nodo)    │
                  └────────────────┘
```

- **Autohospedaje real**: cada instancia corre en la máquina del dueño.
- **Kafka** como bus de eventos para el chat.
- **PostgreSQL** como store durable. Si el proceso muere, el servidor queda *inactivo* —
  nunca se pierden datos.

### Estructura del proyecto

```
recop/
├── apps/                  # "apps" al estilo Django: cada módulo es autocontenido
│   ├── common/            #  base de datos, errores, mixins, utilidades
│   ├── servers/           #  ciclo de vida del servidor (el core del producto)
│   ├── identity/          #  nicknames e identidad *dentro* de un servidor
│   ├── channels/          #  canales / salas de chat
│   └── chat/              #  Kafka + WebSocket
├── core/                  #  configuración, sesión de DB, app factory
├── migrations/            #  Alembic
└── tests/
```

Dentro de cada app, el patrón es siempre el mismo (separación de responsabilidades estilo MVC):

| Capa | Archivo | Responsabilidad |
|---|---|---|
| **Model** | `models.py` | Entidades y persistencia (SQLAlchemy async) |
| **Schema** | `schemas.py` | Contratos de entrada/salida (Pydantic) |
| **Service** | `services.py` | Lógica de negocio. Sin conocimiento de HTTP |
| **API / View** | `api/` | Bindings HTTP. Solo traduce request → service → response |

---

## Desarrollo local

### Requisitos

- Python `>=3.13`
- [uv](https://docs.astral.sh/uv/)
- PostgreSQL
- Kafka

### Puesta en marcha

```bash
uv sync                        # instala dependencias y crea el venv
cp .env.example .env           # ajustá la configuración
docker compose up -d           # levanta postgres + kafka
uv run alembic upgrade head    # aplica migraciones
uv run python -m core          # levanta la API
```

> Para arrancar el nodo se usa `uv run python -m core`. El console script
> `recop-api` también existe y funciona en instalaciones reales del paquete,
> pero algunas versiones de `uv` fallan al lanzarlo en modo `uv run`.

### Calidad

```bash
uv run ruff check .            # lint
uv run ruff format .           # formato
uv run mypy .                  # tipos
uv run pytest                  # tests
```

Los tests de integración necesitan PostgreSQL. Si no definís
`RECOP_TEST_DATABASE_URL` se omiten solos, así que `pytest` funciona igual en un
entorno sin infraestructura:

```bash
createdb recap_test
make test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test
```

---

## Estado del desarrollo

Cada funcionalidad se desarrolla en su propia rama y se sube como **Pull Request** para revisión
manual. Nada se mergea automáticamente.

Ver `docs/architecture.md` para las decisiones de diseño y el razonamiento detrás de cada una.

---

## Licencia

Por definir.