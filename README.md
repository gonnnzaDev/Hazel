<h1 align="center">Recop</h1>

<p align="center">
  <b>Tu chat. Tu máquina. Tu puerto.</b><br>
  Charlá con tus amigos en un servidor que vive en tu propia compu.
</p>

---

## Qué es

Recop es un chat como Discord, pero **sin nadie en el medio**. No hay empresa ni servidores ajenos: el servidor lo prendés vos.

1. Encendés tu servidor.
2. Le pasás tu dirección a tus amigos.
3. Chatean.
4. Cuando querés, lo apagás y se cierra todo.

**Sin cuentas:** entrás con un nombre y listo. El mismo nombre puede existir en dos servidores distintos, y son dos personas distintas.

**Sin sorpresas:** si el servicio se cae, es porque apagaste tu compu.

---

## Qué necesitás

- Docker, o bien Python 3.13+, PostgreSQL y Kafka si preferís instalarlo a mano
- Git
- Que tus amigos puedan llegar a tu compu (el puerto que elijas tiene que estar accesible)

---

## Instalación

### Con Docker (lo más fácil)

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
cp .env.example .env
docker compose up
```

### A mano

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
uv sync
cp .env.example .env
docker compose up -d
uv run alembic upgrade head
uv run python -m core
```

> Muy pronto: un instalador de un solo paso para Windows, macOS, Linux y Android (Termux).

---

## Cómo se usa

### Con la app de escritorio

```bash
make front
```

Desde ahí creás tus servidores, los encendés y apagás, copiás la dirección para
tus amigos y chateás. Ver [`front/README.md`](front/README.md).

### Desde la terminal

Encendé todo:

```bash
make up     # base de datos y Kafka
make api    # tu nodo
```

En otra terminal, creá tu servidor:

```bash
curl -X POST localhost:7272/api/v1/servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Casa de Luis","slug":"casa-de-luis",
       "owner_nickname":"luis","bind_port":7272}'
```

Te devuelve un `id` y tu puerto queda abierto.

Después, lo de todos los días:

```bash
# Ver la dirección para pasarles a tus amigos
curl localhost:7272/api/v1/servers/{id}/address

# Ver tus servidores
curl localhost:7272/api/v1/servers

# Apagar un servidor (no se pierde nada)
curl -X POST localhost:7272/api/v1/servers/{id}/deactivate

# Volver a prenderlo
curl -X POST localhost:7272/api/v1/servers/{id}/activate
```

---

## Qué pasa cuando lo apagás

| Estado | Puerto | Tus datos |
|---|---|---|
| Activo | Abierto | Intactos |
| Apagado a propósito | Cerrado | Intactos |
| Apagado porque se cayó | Cerrado | Intactos |
| Eliminado | Cerrado | Borrados |

**Apagar nunca borra nada.** Si tu compu se reinicia, tus servidores vuelven apagados pero con todo adentro. Los prendés de nuevo y siguen como los dejaste.
