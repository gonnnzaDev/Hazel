# API de Recop

Contrato completo del sistema. Este documento es la referencia: lo que está acá es
lo que la API tiene que exponer, antes de que exista la implementación.

**Estado de cada endpoint:**

| Marca | Significado |
|---|---|
| `[x]` | Implementado y testeado |
| `[~]` | Parcial |
| `[ ]` | Planificado, todavía no existe |

---

## Cómo leer este documento

- Los endpoints cuelgan de `/api/v1`.
- Todo lo que no sea `GET` acepta y devuelve JSON.
- Los errores usan `application/problem+json` (RFC 9457).
- No hay cuentas globales. **La identidad es un nickname dentro de un servidor.**
- WebSocket en `/api/v1/ws`.

---

## 0. Conceptos

Antes de los endpoints, las cuatro cosas que hay que tener claras.

### Nodo

El proceso Recop corriendo en una PC. Es **la unidad que alguien instala y
levanta**. Un nodo:

- escucha en **un solo puerto**
- puede hostear **varios servidores**
- es propiedad de quien lo levantó

El puerto del nodo es lo que se comparte. Cuando el nodo se apaga, el puerto se
cierra y **nadie más puede entrar a ningún servidor suyo**. Cuando vuelve, los
datos siguen ahí.

### Servidor

Un "servidor" en el sentido de Discord: un grupo de personas con sus propios
canales. Pertenece a un nodo. Crear y borrar un servidor **no** abre ni cierra el
puerto del nodo: para eso está el ciclo de vida del nodo.

> **Decisión de diseño que quiero que revises.** Tu descripción original fue
> "despliego mi servidor y se abre un puerto en mi pc". La lectura que
> implementé es: el **nodo** tiene el puerto, y dentro hay servidores. Es lo que
> permite que un cliente (de PC o futuro mobile) se conecte a una sola dirección y
> ver varios servidores, como en Discord. La alternativa es 1 nodo = 1 servidor =
> 1 proceso por grupo, que es más literal pero obliga a correr un proceso por
> cada chat que tengas. Decime cuál preferís.

### Miembro

Una persona dentro de un servidor, identificada por su **nickname**. El mismo
nickname en dos servidores distintos son dos personas sin relación.

### Canal

Una sala dentro de un servidor. Hay canales de texto y de voz.

---

## 1. Nodo — el ciclo de vida del proceso

```
                 ┌──────────────────────────────────────────┐
                 │              NODO                        │
  puerto        │                                          │
  cerrado ──────┤  servidor_a    servidor_b    servidor_c   │
                 │  │             │             │          │
  puerto  ──────┤  └─ canales ────┴─ canales ────┘          │
  abierto       │                                          │
                 └──────────────────────────────────────────┘
```

| Método | Ruta | Qué hace |
|---|---|---|
| `[x]` | `GET /health` | Liveness. Responde si el proceso vivo. |
| `[x]` | `GET /health/ready` | Readiness. Verifica DB y Kafka. 503 si no puede servir. |
| `[x]` | `GET /api/v1/node` | Ficha del nodo: versión, puerto, capacidades. |
| `[x]` | `GET /api/v1/node/address` | Dirección real para compartir. Resuelve la IP local. |

> **No hay `POST /node/start` ni `POST /node/stop`.** El puerto del nodo es el
> del proceso: si el nodo está corriendo, el puerto está abierto. Un endpoint
> HTTP que apaga el propio proceso HTTP es raro de razonar y de testear, y no
> aporta nada que `Ctrl+C` o `docker compose stop` no hagan mejor. El dueño
> apaga su nodo por fuera y los datos quedan intactos.

### `GET /api/v1/node/address` — el punto crítico

Este endpoint resuelve el problema de que `0.0.0.0` no es conectable.

```json
{
  "port": 7272,
  "bind_host": "0.0.0.0",
  "is_wildcard": true,
  "recommended": "192.168.1.50",
  "candidates": [
    { "host": "192.168.1.50", "family": "ipv4", "private": true, "loopback": false },
    { "host": "10.8.0.2",     "family": "ipv4", "private": true, "loopback": false }
  ]
}
```

El backend **no adivina una sola respuesta**: devuelve todas las direcciones
encontradas, ordenadas (IPv4 privada, IPv6 privada, pública, loopback), y
`recommended` es solo la primera. Un nodo puede tener VPN, docker, o tres placas
de red, y elegir mal es peor que mostrar las opciones.

Si la máquina no tiene ninguna dirección usable —un contenedor sin red, por
ejemplo— devuelve `candidates: []` y `recommended: null` en vez de fallar. El
cliente muestra un mensaje útil.

**Pendiente de tu decisión:** ¿le pedimos al dueño que elija su IP al desplegar, o
lo resolvemos con detección automática como arriba?

---

## 2. Servidores (guilds)

| Método | Ruta | Qué hace |
|---|---|---|
| `[x]` | `POST /api/v1/servers` | Crear un servidor. |
| `[x]` | `GET /api/v1/servers` | Listar, paginado. |
| `[x]` | `GET /api/v1/servers/{server_id}` | Detalle con canales. |
| `[x]` | `GET /api/v1/servers/by-slug/{slug}` | Buscar por identificador. |
| `[x]` | `PATCH /api/v1/servers/{server_id}` | Editar nombre, descripción, límites. |
| `[x]` | `DELETE /api/v1/servers/{server_id}` | Eliminar de forma permanente. |
| `[x]` | `POST /api/v1/servers/{server_id}/activate` | Servidor activo. |
| `[x]` | `POST /api/v1/servers/{server_id}/deactivate` | Servidor inactivo, conserva datos. |
| `[x]` | `POST /api/v1/servers/{server_id}/heartbeat` | Latido del proceso. |
| `[x]` | `GET /api/v1/servers/{server_id}/address` | Dirección: el puerto del nodo + su slug. |

### Estados

| Estado | Acepta tráfico |
|---|---|
| `creating` | No (efímero, nunca visible para el cliente) |
| `active` | **Sí** |
| `inactive` | No — apagado o proceso caído |
| `deleted` | No — terminal |

> `inactive` **no** es "borrado". Un servidor inactivo conserva canales, miembros y
> mensajes, y se puede volver a activar. Al arrancar el nodo, todo servidor que
> figure `active` pasa a `inactive`, porque si el proceso anterior se cerró ese
> puerto ya no está escuchando.

---

## 3. Identidad — nicknames

Acá está el corazón del producto: **no hay cuentas globales**. Alguien abre el
puerto de un nodo, elige un nickname y entra. Sin email, sin password, sin
registro.

| Método | Ruta | Qué hace |
|---|---|---|
| `[x]` | `POST /api/v1/servers/{server_id}/join` | Entrar con un nickname. Devuelve token. |
| `[x]` | `POST /api/v1/servers/{server_id}/leave` | Salir del servidor. |
| `[x]` | `POST /api/v1/auth/refresh` | Renovar el token (rota el viejo). |
| `[x]` | `POST /api/v1/auth/logout` | Revocar el token de este dispositivo. |
| `[x]` | `POST /api/v1/auth/logout-all` | Revocar todos los tokens de este servidor. |
| `[x]` | `GET /api/v1/me` | Quién soy en el servidor de este token. |
| `[x]` | `PATCH /api/v1/me` | Cambiar mi nombre visible. |
| `[x]` | `GET /api/v1/servers/{server_id}/members` | Listar miembros. |
| `[x]` | `GET /api/v1/servers/{server_id}/members/{nickname}` | Ver un miembro. |
| `[x]` | `DELETE /api/v1/servers/{server_id}/members/{nickname}` | Expulsar. |
| `[x]` | `PUT /api/v1/servers/{server_id}/members/{nickname}/role` | Cambiar el rol (`?role=admin`). |

### `POST /api/v1/servers/{server_id}/join`

```http
POST /api/v1/servers/01a1.../join
{ "nickname": "Ana" }
```

```json
{
  "token": "kJ8xQm2nVr7pL4sT...",
  "expires_at": "2026-11-10T03:14:00Z",
  "member": {
    "id": "01a1...",
    "nickname": "ana",
    "display_name": "Ana",
    "role": "owner",
    "is_online": false,
    "last_seen_at": null,
    "joined_at": "2026-10-11T23:50:17Z"
  },
  "server": { "id": "01a1...", "slug": "casa-de-luis", "name": "Casa de Luis" }
}
```

El rol sale como **texto** (`"owner"`), no como el número que se guarda en la
base. La base ordena por número porque comparar roles es comparar enteros; la
API habla con palabras porque un cliente no debería tener que saber que admin
es 50.

**El token está scopeado al servidor.** El mismo token no sirve en otro servidor.
Si Ana está en `casa-de-luis` y en `gym-de-martes`, tiene **dos tokens
distintos**: son dos identidades distintas, no una persona con dos perfiles.

### Reglas del nickname

Centralizadas en `apps/common/nickname.py`:

- 2 a 32 caracteres
- Solo `a-z`, `0-9`, `.`, `_`, `-`
- Se normaliza: `"  José  Luis "` → `"jose_luis"`
- Reservados: `admin`, `everyone`, `here`, `sistema`, `recop`, `root`, ...

Un nickname puede ser válido en un servidor y estar tomado en otro. Eso no es un
conflicto: es el punto.

### Volver a entrar

Si el nickname ya existe en ese servidor, **entrar de nuevo con el mismo nombre
funciona**: recuperás el acceso y recibís un token nuevo. Así se resuelve "perdí
la contraseña" en un producto sin cuentas: entrás otra vez con el mismo nombre.

El trade-off es explícito: alguien que adivine tu nickname entra como vos. En
una red local con amigos es aceptable; en un servidor abierto no lo sería, y
por eso el rate limit y el límite de miembros existen.

### El dueño

- El **primer miembro** de un servidor es su dueño.
- Si el dueño se va, el rol pasa al miembro **más antiguo** que quede. Un
  servidor sin dueño no se podría administrar ni borrar.
- Ni un admin puede expulsar al dueño. El dueño se va si quiere.
- El rol de dueño no se asigna ni se quita por API.

---

## 4. Roles y permisos

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `GET /api/v1/servers/{server_id}/roles` | Listar roles. |
| `[ ]` | `POST /api/v1/servers/{server_id}/roles` | Crear rol personalizado. |

Los tres roles base ya se aplican: un miembro deja de tener `member` o `member` y
pasa a `admin` con `PUT .../role?role=admin`.

### Roles base

| Rol | Puede |
|---|---|
| `owner` | Todo, incluido borrar el servidor y el nodo. No se puede quitar ni ceder. |
| `admin` | Gestionar canales, miembros y roles. No borrar el servidor. |
| `member` | Chatear. Es el rol por defecto de cualquiera que entre. |

Los roles personalizados llegan después. El modelo de permisos queda abierto para
que lo definas.

---

## 5. Canales

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `POST /api/v1/servers/{server_id}/channels` | Crear canal. |
| `[ ]` | `GET /api/v1/servers/{server_id}/channels` | Listar canales. |
| `[ ]` | `GET /api/v1/servers/{server_id}/channels/{channel_id}` | Ver un canal. |
| `[ ]` | `PATCH /api/v1/servers/{server_id}/channels/{channel_id}` | Editar. |
| `[ ]` | `DELETE /api/v1/servers/{server_id}/channels/{channel_id}` | Eliminar. |
| `[ ]` | `POST /api/v1/servers/{server_id}/channels/{channel_id}/join` | Entrar al canal (abrir el socket). |

Cada servidor tiene exactamente un canal `is_default`, que es donde cae la gente
al entrar. Está garantizado por constraint en la base, no solo por código.

---

## 6. Mensajes

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `POST /api/v1/channels/{channel_id}/messages` | Publicar. |
| `[ ]` | `GET /api/v1/channels/{channel_id}/messages` | Historial paginado. |
| `[ ]` | `GET /api/v1/channels/{channel_id}/messages/{message_id}` | Ver uno. |
| `[ ]` | `PATCH /api/v1/channels/{channel_id}/messages/{message_id}` | Editar. |
| `[ ]` | `DELETE /api/v1/channels/{channel_id}/messages/{message_id}` | Borrar. |
| `[ ]` | `POST /api/v1/channels/{channel_id}/messages/{message_id}/reactions` | Reaccionar. |
| `[ ]` | `DELETE /api/v1/channels/{channel_id}/messages/{message_id}/reactions/{emoji}` | Quitar reacción. |

### Paginación

Cursor por `message_id`, que es UUID v7, así que el orden por id **es** el orden
cronológico. No hace falta un índice extra ni un campo `created_at` para ordenar.

```http
GET /api/v1/channels/01a1.../messages?limit=50&before=01a1...f3e2
```

### Publicar un mensaje

```http
POST /api/v1/channels/01a1.../messages
Authorization: Bearer <token>

{ "content": "¿alguien se anima?", "reply_to": "01a1...", "attachments": [] }
```

```json
{
  "id": "01a12d5f-d54a-7b90-57047f430a41",
  "channel_id": "01a12d5f-d54a-715f-a24a-2e3e9f0f0bf6",
  "author": { "nickname": "ana", "display_name": "Ana" },
  "content": "¿alguien se anima?",
  "created_at": "2026-10-11T23:52:03Z",
  "edited_at": null,
  "reactions": [],
  "reply_to": "01a1...",
  "attachments": []
}
```

**Límites:** 4000 bytes por mensaje, 20 mensajes por minuto y por nickname. El
rate limit es por nickname, no por IP: en una red local todos pueden estar detrás
del mismo router y no es justo cortar el servicio.

---

## 7. WebSocket — tiempo real

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `WS /api/v1/ws?token=<token>` | Canal de eventos. |

El token va por query string porque el navegador y varios clientes mobile no
permiten custom headers en el handshake de WebSocket.

### Eventos del servidor

```json
{ "type": "message.created", "server_id": "...", "channel_id": "...", "data": { } }
```

| Evento | Cuándo |
|---|---|
| `message.created` | Alguien escribió. |
| `message.updated` | Alguien editó. |
| `message.deleted` | Alguien borró. |
| `reaction.added` | Alguien reaccionó. |
| `reaction.removed` | Alguien quitó la reacción. |
| `presence.update` | Alguien entró o salió. |
| `typing.start` | Alguien está escribiendo. |
| `member.joined` | Alguien entró al servidor. |
| `member.left` | Alguien salió. |
| `server.updated` | Cambió el nombre, los canales, etc. |
| `server.state_changed` | El servidor cambió de estado. |
| `node.state_changed` | El nodo abrió o cerró el puerto. |

### Eventos del cliente

```json
{ "type": "typing.start", "channel_id": "..." }
{ "type": "channel.subscribe", "channel_id": "..." }
{ "type": "heartbeat" }
```

El servidor ignora eventos desconocidos en vez de cortar la conexión. Un cliente
mobile viejo que no conoce un evento nuevo no se cae.

---

## 8. Invitaciones y descubrimiento

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `POST /api/v1/servers/{server_id}/invites` | Crear invitación. |
| `[ ]` | `GET /api/v1/invites/{code}` | Ver una invitación. |
| `[ ]` | `DELETE /api/v1/invites/{code}` | Revocar. |

**Decisión tomada:** el descubrimiento es manual. No hay registro central donde
publicar "hay un servidor en 192.168.1.50:7272". El dueño comparte `host:puerto`
como se lo compartía antes de internet: por mensaje. Una invitación es un código
corto que apunta al nodo, para no tener que escribir la IP a mano.

> **Pendiente de tu decisión:** ¿alcanza con compartir `host:puerto`, o querés
> alguna forma de descubrimiento (una invitación con código corto, un QR, un
> directorio público de servidores)?

---

## 9. Archivos

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `POST /api/v1/channels/{channel_id}/attachments` | Subir. |
| `[ ]` | `GET /api/v1/attachments/{attachment_id}` | Descargar. |
| `[ ]` | `DELETE /api/v1/attachments/{attachment_id}` | Borrar. |

> **Pendiente de tu decisión:** ¿los archivos se guardan en el disco del nodo, o
> en almacenamiento externo (S3 y compatibles)? En un nodo autohospedado, disco
> local es lo simple, pero tiene el límite de espacio de la PC del dueño.

---

## 10. Mantenimiento

| Método | Ruta | Qué hace |
|---|---|---|
| `[ ]` | `GET /api/v1/servers/{server_id}/stats` | Miembros, mensajes, tamaño. |
| `[ ]` | `POST /api/v1/servers/{server_id}/backup` | Backup a archivo. |
| `[ ]` | `POST /api/v1/servers/{server_id}/restore` | Restaurar desde backup. |
| `[ ]` | `GET /api/v1/servers/{server_id}/events` | Auditoría. |

Esto no es secundario: es lo que le da confianza al dueño de que sus datos están en su
PC y son recuperables.

---

## 11. Errores

Todos los errores usan `application/problem+json`:

```json
{
  "type": "https://recop.dev/errors/server_inactive",
  "title": "Servidor inactivo",
  "status": 409,
  "code": "server_inactive",
  "detail": "El servidor está inactive. No acepta conexiones hasta que su dueño lo vuelva a activar.",
  "server_id": "01a1...",
  "status": "inactive"
}
```

### Catálogo

| `code` | HTTP | Cuándo |
|---|---|---|
| `server_not_found` | 404 | El servidor no existe. |
| `server_not_found_by_slug` | 404 | Ningún servidor con ese identificador. |
| `server_inactive` | 409 | Se intentó usar un servidor apagado. |
| `server_deleted` | 409 | Se intentó usar un servidor borrado. |
| `invalid_state_transition` | 409 | Transición imposible en el ciclo de vida. |
| `slug_taken` | 409 | El identificador ya existe. |
| `port_taken` | 409 | El puerto está ocupado por otro servidor activo. |
| `nickname_taken` | 409 | El nickname ya existe en ese servidor. |
| `nickname_reserved` | 422 | El nickname está en la lista reservada. |
| `nickname_invalid_charset` | 422 | Caracteres no permitidos. |
| `nickname_too_short` / `_too_long` | 422 | Largo fuera de rango. |
| `unauthenticated` | 401 | Falta el token o venció. |
| `forbidden` / `not_owner` | 403 | No tiene permisos. |
| `rate_limited` | 429 | Superó el límite de mensajes. |
| `message_too_large` | 413 | Mensaje de más de 4000 bytes. |
| `validation_error` | 422 | El cuerpo no cumple el contrato. |

---

## 12. Versionado

- Todo bajo `/api/v1`.
- Los cambios que rompen contrato dan lugar a `/api/v2`.
- Los cambios aditivos (un endpoint nuevo, un campo opcional) no versionan.

La API no asume que el cliente es una PC. Un cliente mobile debería poder
generar sus tipos desde el OpenAPI sin effort.

---

## 13. Qué falta decidir

Estas son preguntas de producto, no de implementación. Las dejo abiertas hasta
que las resuelvas:

1. **Kafka en la PC del usuario.** Pediste Kafka para el chat, pero es una
   dependencia pesada para un proceso de escritorio. ¿Kafka embebido, Kafka
   externo, o un bus con dos implementaciones?
2. ~~Nodo con N servidores vs nodo = 1 servidor.~~ **Resuelto:** el nodo tiene N
   servidores. Ver sección 0. Si querés la lectura literal, es un refactor.
3. ~~Resolución de la IP compartible.~~ **Parcial:** la API devuelve todas las
   candidatas y el cliente elige. Falta definir cómo lo muestra el cliente de PC.
4. **Descubrimiento de servidores.** Ver sección 8.
5. **Dónde viven los archivos.** Ver sección 9.
6. **Roles personalizados.** ¿Hace falta, o tres roles alcanza para la primera
   versión?
7. **Nombre personal vs nickname.** Dijiste que el usuario puede tener un nombre
   propio para uso personal, pero que el nickname era lo único a implementar.
   ¿Eso es una entidad nueva o el mismo `display_name`?