<div align="center">

# Recop

**Tu chat. Tu máquina. Tu puerto.**

[Qué es](#qué-es) · [Instalación](#instalación) · [Uso](#uso) · [Desarrollo](#desarrollo)

</div>

---

## Qué es

Recop es un chat tipo Discord con una diferencia: **nadie te lo hospeda**.

Levantás el servidor en tu propia PC, se abre un puerto en tu máquina, le
pasás `ip:puerto` a tus amigos, y chatean. Cuando dejás de querer el servidor, lo
apagás y el puerto se cierra.

**No hay cuentas.** Entrás con un nombre y listo. El mismo nombre puede existir en
dos servidores y son dos personas distintas.

No hay empresa en el medio. Si se cae el servicio, es porque se apagó tu
computadora.

---

## Instalación

### Docker

La forma más segura de que todos tengan exactamente lo mismo:

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
cp .env.example .env
docker compose up
```

### A mano

Necesitás Python 3.13+, PostgreSQL y Kafka:

```bash
uv sync                      # instala las dependencias
cp .env.example .env
docker compose up -d         # solo PostgreSQL + Kafka
uv run alembic upgrade head
uv run python -m core
```

> **Próximamente:** un script único que instale todo solo y funcione en Linux,
> macOS, Windows y Android (Termux). Hoy todavía hay que hacer los pasos a mano.

---

## Uso

```bash
make up        # levanta PostgreSQL y Kafka
make api       # arranca el nodo
```

Después, en otra terminal:

```bash
# Desplegar un servidor
curl -X POST localhost:7272/api/v1/servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Casa de Luis","slug":"casa-de-luis",
       "owner_nickname":"luis","bind_port":7272}'
```

Te devuelve un `id` y el puerto queda abierto.

```bash
# Ver la dirección para compartir
curl localhost:7272/api/v1/servers/{id}/address

# Ver los servidores
curl localhost:7272/api/v1/servers

# Apagar (conserva todos los datos)
curl -X POST localhost:7272/api/v1/servers/{id}/deactivate

# Volver a encender
curl -X POST localhost:7272/api/v1/servers/{id}/activate
```

### Los cuatro estados

| Estado | Puerto | Datos |
|---|---|---|
| Activo | Abierto | Intactos |
| Inactivo (apagado a propósito) | Cerrado | Intactos |
| Inactivo (el proceso se cayó) | Cerrado | Intactos |
| Eliminado | Cerrado | Borrados |

**Apagar nunca borra nada.** Si tu proceso se muere, al reiniciar el nodo todos
tus servidores aparecen apagados, con todo adentro. Los prendés otra vez y
siguen ahí.

---

## Desarrollo

```bash
make check      # lint + formato + tipos + tests
make test       # solo tests
make test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test
```

### Estructura

```
recop/
├── apps/            # cada módulo es autocontenido
│   ├── common/      #   tipos, errores, reglas de nickname
│   ├── servers/     #   ciclo de vida del servidor
│   ├── identity/    #   nicknames y tokens      ← pendiente
│   ├── channels/    #   salas de chat           ← pendiente
│   └── chat/        #   Kafka + WebSocket       ← pendiente
├── core/            # configuración, base de datos, app factory
├── migrations/      # Alembic
└── tests/
```

Dentro de cada app, siempre las mismas cuatro capas:

| Archivo | Qué hace |
|---|---|
| `models.py` | Los datos y cómo se guardan |
| `schemas.py` | Qué entra y qué sale |
| `services.py` | Las reglas del negocio |
| `api/` | Conectar HTTP con el service |

`services.py` nunca importa FastAPI. Eso permite testearlo sin levantar nada, y
va a servir igual para el futuro cliente mobile.

---

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/api.md`](docs/api.md) | Los 57 endpoints y qué hace cada uno |
| [`docs/architecture.md`](docs/architecture.md) | Por qué se decidió cada cosa |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Cómo contribuir y cómo está armado el código |

---

## Estado

Es una beta temprana. El backend de los servidores ya anda; el chat todavía no.

Lo que falta:

- [ ] Nicknames y entrada a un servidor
- [ ] Canales
- [ ] Chat con Kafka y WebSocket
- [ ] Instaladores para Windows, macOS, Linux y Android

---

## Licencia

Por definir.