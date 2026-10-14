NODE MODULE — HOW IT WORKS
============================

1. WHAT THE NODE IS
The node is the Hazel process running on the owner's machine. It is what you
install, start, and share. It listens on ONE port (default 7272) and hosts
N servers ("groups") inside it. While the node runs, the port is open;
when it stops, nobody can reach any of its groups. Stopping never deletes
data.

2. TWO PROCESSES, TWO ROLES
- Node process (`python -m core` / `node`): the owner's control panel. It
  creates groups, assigns ports, and supervises group processes.
- Group process (`python -m core group --server-id=... --port=...`): serves
  exactly ONE group (its chat, members and calls) on its own port.
A group never manages other groups: group routes fail with `not_the_node`
outside the node process.

3. SUPERVISOR (`supervisor.py`)
Keeps one live child process per active group:
- `spawn()`: launches `sys.executable -m core group ...` with a guard pipe
  as stdin. If the node dies, the pipe closes, the child reads EOF and
  exits by itself — no zombie processes holding ports.
- `wait_ready()`: waits up to 20s for the child to answer its heartbeat.
- `terminate()`: stops a child and frees its port.
- `used_ports()` / `status()`: live ports and per-group process state
  (running, pid, uptime, exit code), separate from the DB status so crashes
  are visible as "process dead but row says active".

4. GROUP LIFECYCLE (`service.py`)
- `create_group()`: validates the slug, takes a free port (avoids
  DB-registered ports AND live-process ports), writes the row as CREATING,
  spawns the process, then marks ACTIVE only if it answers ready —
  otherwise INACTIVE. Deploy implies start.
- `start_group()`: reopens a stopped group, reusing its reserved port when
  free; already-running is a no-op.
- `stop_group()`: kills the process, marks INACTIVE, keeps all data, keeps
  the port reserved.
- `delete_group()`: kills the process first, then deletes the row
  (the only destructive op).
- `ensure_can_manage()`: only admins manage groups; only the node OWNER
  deletes them.

5. PORTS (`repository.py` + `ports.py`)
Group ports come from `port+1 .. group_port_end`. Inactive groups keep
their port reserved so a restart finds everything where it was. A port is
free only if no row holds it AND no live process uses it AND the OS has it
free.

6. SHAREABLE ADDRESS
The node binds `0.0.0.0` (a wildcard, not a destination), so
`GET /node/address` returns every usable interface sorted
(private IPv4 first) plus a `recommended` one. `group_address()` combines
group port + node host into the `host:port` string owners share by hand.
There is no central directory: discovery is manual.

7. CRASH MODEL
If the process dies (crash, power off, kill), groups stay marked ACTIVE in
the DB while nothing listens. On next boot the node marks everything
INACTIVE (`mark_all_inactive`); the owner reactivates and finds channels,
members and messages intact. `heartbeat()` lets a group prove it is alive
so the panel can tell "turned off" apart from "crashed".

8. HTTP SURFACE (`view.py`, `schemas.py`)
- `GET /node`: card (service, version, env, bind host/port, kafka prefix).
- `GET /node/address`: port, wildcard flag, candidates, recommended,
  group port range.
Group deploy/start/stop/delete run through the servers endpoints inside the
node process, guarded by `supervisor_from()`.

9. CONFIGURATION
`HAZEL_HOST` / `HAZEL_PORT` (listen), `HAZEL_GROUP_PORT_END` (range top),
`HAZEL_ROLE=group` (child-process marker injected by the supervisor).

========================================
MÓDULO NODE — CÓMO FUNCIONA
========================================

1. QUÉ ES EL NODO
El nodo es el proceso Hazel corriendo en la PC del dueño. Es lo que instalás,
levantás y compartís. Escucha en UN solo puerto (7272 por defecto) y hospeda
N servidores ("grupos") adentro. Mientras corre, el puerto está abierto;
cuando se apaga, nadie entra a ningún grupo. Apagar nunca borra datos.

2. DOS PROCESOS, DOS ROLES
- Proceso nodo (`python -m core` / `node`): el panel del dueño. Crea grupos,
  reparte puertos y supervisa los procesos de grupo.
- Proceso de grupo (`python -m core group --server-id=... --port=...`):
  sirve UN solo grupo (su chat, miembros y llamadas) en su propio puerto.
Un grupo nunca maneja otros grupos: sus rutas fallan con `not_the_node`
fuera del proceso nodo.

3. SUPERVISOR (`supervisor.py`)
Mantiene un proceso hijo vivo por grupo activo:
- `spawn()`: lanza `sys.executable -m core group ...` con un pipe de guarda
  como stdin. Si el nodo muere, el pipe se cierra, el hijo lee EOF y sale
  solo — sin procesos zombies ocupando puertos.
- `wait_ready()`: espera hasta 20s a que el hijo responda su latido.
- `terminate()`: frena un hijo y libera su puerto.
- `used_ports()` / `status()`: puertos vivos y estado por grupo (corriendo,
  pid, uptime, exit code), separado del estado en DB para que un crash se
  vea como "proceso muerto pero la fila dice activo".

4. CICLO DE VIDA (`service.py`)
- `create_group()`: valida el slug, toma un puerto libre (evita puertos en
  DB Y en procesos vivos), escribe la fila como CREATING, levanta el proceso
  y recién marca ACTIVE si responde — si no, INACTIVE. Desplegar implica
  encender.
- `start_group()`: reabre un grupo apagado, reutilizando su puerto
  reservado si está libre; si ya corre, no hace nada.
- `stop_group()`: mata el proceso, marca INACTIVE, conserva datos y puerto.
- `delete_group()`: mata el proceso primero y después borra la fila (la
  única operación destructiva).
- `ensure_can_manage()`: solo admins manejan grupos; solo el OWNER del nodo
  los elimina.

5. PUERTOS (`repository.py` + `ports.py`)
Los puertos salen de `port+1 .. group_port_end`. Los grupos apagados
conservan su puerto para reencontrar todo al volver. Un puerto está libre
solo si ninguna fila lo tiene Y ningún proceso vivo lo usa Y el SO lo tiene
libre.

6. DIRECCIÓN COMPARTIBLE
El nodo escucha en `0.0.0.0` (comodín, no destino), así que
`GET /node/address` devuelve todas las interfaces útiles ordenadas (IPv4
privada primero) más una `recommended`. `group_address()` combina puerto
del grupo + host del nodo en el `host:puerto` que el dueño comparte a mano.
No hay directorio central: el descubrimiento es manual.

7. MODELO DE CRASH
Si el proceso muere (crash, corte de luz, kill), los grupos quedan ACTIVE
en la DB sin nadie escuchando. Al rearrancar, el nodo los marca INACTIVE
(`mark_all_inactive`); el dueño los reactiva y encuentra canales, miembros
y mensajes intactos. `heartbeat()` deja al grupo probar que sigue vivo para
distinguir "apagado" de "caído".

8. SUPERFICIE HTTP (`view.py`, `schemas.py`)
- `GET /node`: ficha (servicio, versión, entorno, host/puerto, prefijo kafka).
- `GET /node/address`: puerto, flag wildcard, candidatas, recomendada,
  rango de puertos de grupo.
Crear/encender/apagar/borrar grupos pasa por los endpoints de servers
dentro del proceso nodo, custodiados por `supervisor_from()`.

9. CONFIGURACIÓN
`HAZEL_HOST` / `HAZEL_PORT` (escucha), `HAZEL_GROUP_PORT_END` (tope del
rango), `HAZEL_ROLE=group` (marca de proceso hijo que inyecta el
supervisor).
