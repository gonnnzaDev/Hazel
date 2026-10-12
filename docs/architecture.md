# Arquitectura de Recop

Documento de decisiones de diseño. Cada decisión está escrita con su *por qué*
para que las conversaciones futuras tengan contexto y no se revierta todo cada
vez que aparece una idea nueva.

> El contrato de la API está en [`api.md`](./api.md). Este documento explica
> **por qué**; aquel dice **qué**.

---

## 1. El producto: qué es un "servidor"

En Recop un **servidor** no es un concepto abstracto en la nube. Es un proceso
que corre en la PC de una persona y escucha en un puerto de esa máquina.

```
Dueño                                Invitado
  │                                     │
  │  levanta el nodo                    │
  │  → abre :7272 en su PC              │
  │                                     │
  └──────────  se comparte host:puerto ──────────► se conecta
                                                │
                                          entra con su nickname
```

**Consecuencias directas:**

- Si el dueño apaga su PC, el servidor deja de existir para el mundo exterior.
  Eso es correcto: nadie puede mandar sobre un servidor que no está corriendo.
- Si el proceso muere por un crash, el servidor queda **inactivo**, no
  destruido. Todos sus datos sobreviven en PostgreSQL. Al volver a levantarlo,
  todo sigue ahí.
- Borrar un servidor es una decisión del dueño. Si se borra, el puerto se cierra
  y no hay nadie a quien apuntar.

---

## 2. Identidad: nickname y nada más

**Decisión:** no hay cuentas globales. Sin email, sin password, sin registro.

Una persona se identifica con un **nickname dentro de un servidor**. El mismo
nickname en dos servidores son dos personas sin relación entre sí.

**Por qué:**

- El modelo mental de Recop es "esto lo hospeda mi amigo en su casa". Un
  registro global implica una autoridad central, que es justo lo que Recop
  elimina.
- Abre la puerta a que alguien entre al servidor de un desconocido sin fricción:
  abre el puerto, elige nickname, entra.
- Reduce la superficie de ataque: no hay passwords que filtrar ni fuerza bruta
  que implementar.

**Pendiente por decisión del usuario:** el usuarioreserve un nombre propio para
uso personal (chats privados). Está explícitamente fuera de alcance hasta que se
diseñe; la arquitectura no lo impide.

### Roles

El dueño del servidor es su administrador. Se modelan roles por nivel:

| Nivel | Rol | Puede |
|---|---|---|
| `owner` | Dueño | Todo, incluido borrar el servidor |
| `admin` | Administrador | Gestionar canales y miembros |
| `member` | Miembro | Chatear |

---

## 3. Por qué PostgreSQL

El servidor guarda mensajes, canales, miembros y el estado del propio servidor.
Necesitamos:

- Durabilidad: si el proceso se cae, no se pierde nada.
- Consultas sobre historial con paginación y filtros.
- Integridad referencial real entre canales, mensajes y miembros.
- Controles de concurrencia: varias personas pueden estar escribiendo en el
  mismo canal al mismo tiempo.

SQLite no da nada de esto de forma razonable cuando el chat es real.

---

## 4. Por qué Kafka para el chat

**Decisión del usuario:** Apache Kafka transporta el chat.

Kafka aporta:

- **Fan-out** a varios consumidores del mismo topic, que es literalmente lo que
  hace un canal con N personas conectadas.
- **Replay**: un cliente que reconecta puede volver a leer desde un offset.
- **Desacople**: el productor (quien escribe) no necesita conocer a los
  consumidores (quienes escuchan).
- **Aislamiento de fallas**: si un consumidor se cae, el mensaje queda en el log.

### La tensión que hay que tener en cuenta

> **Kafka es una dependencia pesada para un proceso que corre en la PC de un
> usuario.** Hablar con un broker único implica levantar ZooKeeper o KRaft, tener
> ZooKeeper operativo, y mantenerlo andando.

Esto es una contradicción real con el objetivo de autohospedaje y hay que
resolverla antes de que el producto se use. Opciones, **pendientes de tu
decisión**:

1. **Modo embebido**: Kafka corre dentro del mismo nodo Recop, en un proceso
   separado que el nodo lanza y administra. El dueño no lo ve; si algo falla,
   el nodo lo reporta.
2. **Transporte con abstracción**: el bus de chat es una interfaz con una
   implementación Kafka y una implementación local. Kafka es el modo "real"
   (multiusuario, varios nodos), el modo local es el default para un solo dueño.
3. **Kafka puro**: el dueño tiene que correr Kafka antes que Recop. Simple de
   implementar, fricción alta de arranque.

La implementación del PR de chat va a exponer el bus como una **interfaz**, así
que la decisión no queda bloqueada. Pero conviene resolverla antes de construir
sobre Kafka.

---

## 5. Estructura: apps estilo Django

Cada funcionalidad vive en `apps/<nombre>/` con el mismo layout siempre:

| Capa | Archivo | Responsabilidad | ¿Sabe de HTTP? |
|---|---|---|---|
| **Model** | `models.py` | Persistencia (SQLAlchemy async) | No |
| **Schema** | `schemas.py` | Contratos Pydantic | No |
| **Service** | `services.py` | Lógica de negocio | **No** |
| **View** | `api/` | Bindings HTTP | Sí |

**Por qué esta separación:**

- La regla dura es que `services.py` no importa nada de FastAPI. La lógica de
  negocio se puede testear sin levantar la API y va a servir igual para un
  futuro cliente mobile que para la PC.
- Los errores de dominio (`core/api/errors.py`) se lanzan desde el service y se
  traducen a `application/problem+json` en un handler global. El service no
  elige códigos HTTP.

`core/registry.py` declara `INSTALLED_APPS`. Es el único lugar donde se agrega o
quita una app, y define el orden en que Alembic ve los modelos.

---

## 6. Mobile después, sin reescribir nada

La API es HTTP + WebSocket, servida por Uvicorn, y el contrato se documenta solo
en OpenAPI. Eso significa que el backend no asume que el cliente es una PC.

Lo que sí conviene sostener desde ahora:

- **Contrato explícito**: los schemas de Pydantic son el contrato. Si cambia, el
  cliente mobile se entera al generar sus tipos.
- **Sin estado de sesión en el servidor** más allá del tiempo de vida natural
  de una conexión. Nada de `HttpOnlySession` atado a un navegador.
- **Errores uniformes** (`application/problem+json`): un cliente mobile puede
  mostrar el error sin casos especiales.
- **Versionado bajo `/api/v1`** desde el primer día. Cambiar el contrato después
  sería un problema; cambiarlo con un prefijo de versión, no.

---

## 7. Estado del servidor

El ciclo de vida que implementa `apps/servers`:

| Estado | Significado | ¿Acepta conexiones? |
|---|---|---|
| `creating` | Se está configurando. Efímero, nunca se expone al cliente | No |
| `active` | Corriendo | **Sí** |
| `inactive` | Apagado o con el proceso caído | No |
| `deleted` | Eliminado por el dueño | No |

Dos reglas que sostienen el producto:

**Crear implica activar.** El dueño pidió desplegar, y un servidor desplegado
escucha. No queda un estado intermedio que el cliente pueda observar.

**Al arrancar el nodo, todo lo que figura `active` pasa a `inactive`.**
Es lo que hace funcionar el requisito de que "si se cierra el proceso, el
servidor quede inactivo pero no funcione". Sin esto, un servidor que se cayó
seguiría marcado como `active` en la base y el sistema creería que su puerto
está abierto. Al volver a encenderlo, el dueño lo reactiva y lo encuentra
**igual**: mismos canales, mismos miembros, mismos mensajes.

> No existe un estado `deleting`. Se evaluó y se descartó: el borrado es síncrono
> e inmediato, así que un estado intermedio nunca sería observable por nadie.
> Si algún día el borrado se vuelve asíncrono porque hay historial pesado que
> limpiar, vuelve.

### Endpoints

```
POST   /api/v1/servers                     desplegar (crea y activa)
GET    /api/v1/servers                     listar, paginado
GET    /api/v1/servers/{id}                detalle con canales
GET    /api/v1/servers/by-slug/{slug}      buscar por el identificador que se comparte
PATCH  /api/v1/servers/{id}                editar nombre / puerto / límite de miembros
POST   /api/v1/servers/{id}/activate       volver a abrir el puerto
POST   /api/v1/servers/{id}/deactivate     cerrar el puerto (conserva los datos)
POST   /api/v1/servers/{id}/heartbeat      reportar que el proceso sigue vivo
GET    /api/v1/servers/{id}/address        el host:puerto para compartir
DELETE /api/v1/servers/{id}                eliminar de forma permanente
```

### Dos cosas que quedan sin resolver

1. **La dirección compartible no siempre lo es.** Por defecto el nodo escucha en
   `0.0.0.0`, que es un comodín: no se puede conectar a `0.0.0.0`. La API lo
   marca con `host_is_wildcard: true` en vez de adivinar la IP del dueño, porque
   un nodo puede tener VPN, docker o varias placas de red. Falta decidir cómo se
   resuelve: ¿el dueño tipea su IP a mano, la detectamos, o se la pedimos una
   vez al desplegar?
2. **El borrado es duro.** Hoy `DELETE` elimina la fila. Con mensajes adentro
   eso es irreversible. ¿Querés borrado lógico, o que se conserve y se marque el
   servidor como eliminado?

---

## Decisiones pendientes

Estas preguntas siguen abiertas a propósito, hasta que las resolvás:

1. **Kafka en la PC del usuario** — ¿cómo se resuelve el problema de la
   dependencia pesada? (ver sección 4)
2. **Descubrimiento de servidores** — si un nodo escucha en `192.168.1.50:7272`,
   ¿cómo lo encuentra un invitado? Hoy la idea es compartir `host:puerto` a mano.
3. **Nombre personal vs nickname** — el usuario mencionó un nombre propio para
   uso personal. ¿Es la misma entidad o separada?
4. **Persistencia por owner** — ¿cada nodo guarda todo en su PostgreSQL local, o
   hay backup/replicación?
5. **Móvil** — ¿nativo, Flutter, React Native? La API no lo condiciona, pero el
   cliente sí.