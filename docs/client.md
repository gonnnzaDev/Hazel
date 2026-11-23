# Cliente de escritorio

Decisión: el primer cliente es una app de escritorio construida con
**Tauri 2 + React + TypeScript**. No está publicada todavía; el código vive en
`client/` y no forma parte del contenedor ni del crate del nodo.

## Por qué Tauri

- El backend ya es Rust: compartimos lenguaje y herramientas con `rust/`.
- El binario es mucho más pequeño que Electron y usa el WebView del sistema.
- El WebView da las APIs que el contrato necesita sin libs nativas extra:
  `fetch`, `WebSocket` (con token en query string) y `RTCPeerConnection` para
  la futura llamada de voz.
- Tauri permite guardar la sesión en el directorio de configuración de la app
  con permisos `0600`, sin añadir un plugin de keychain.

La interfaz tiene un **estilo cómic / manga**: papel crema con trama de puntos,
tinta negra en bordes gruesos, sombras duras desplazadas y un único acento rojo.
Los títulos y botones usan una tipografía condensada en mayúsculas, los mensajes
son globos de diálogo con avatar en círculo y los paneles parecen viñetas. No se
cargan fuentes externas: la app funciona sin conexión. La ventana de Tauri se
declara `transparent: true` para que el WebView deje ver el fondo del sistema.

### Arranque sin intervención

Si falta alguna dependencia, el splash la instala automáticamente: `deps.rs`
detecta qué falta y `install.rs` ejecuta el script del sistema
(`scripts/install-deps-linux.sh`, `install-deps-macos.sh` o
`install-deps-windows.ps1`), embebido en el binario y lanzado con elevación
(`pkexec`/`sudo -n`, `osascript` o `Start-Process -Verb RunAs`). El progreso se
muestra en el splash y, al terminar, se vuelve a comprobar todo. El usuario no
ejecuta ni copia nada, aunque el sistema puede pedir aprobación del diálogo de
permisos. Si la instalación falla, se muestran los comandos como respaldo.

En Linux, el desenfoque del escritorio lo hace el compositor, no Tauri. En KDE
Plasma hay que activar el efecto **Blur** de KWin (`blurEnabled=true` en
`~/.config/kwinrc`, apartado `[Plugins]`) y ajustar `BlurStrength` en
`[Effect-Blur]`. En X11 el equivalente es `picom` con `blur-background = true`.

La pantalla de acceso no usa tarjeta: ocupa toda la ventana en dos columnas
(identidad y pasos a la izquierda, acciones a la derecha) y se apila en una sola
columna por debajo de 900 px. No muestra la dirección del nodo: el cliente usa
la dirección por defecto (`http://127.0.0.1:7272`, definida en `store.ts`).

Después de entrar (o de crear el primer servidor), el chat ocupa toda el área
útil como una **viñeta**: panel con borde negro, sombra dura y cabecera separada
por una línea gruesa. El canal activo queda en negativo con acento rojo. Todo se
define en CSS (`app--session` en `App.tsx` y el bloque «TEMA CÓMIC / MANGA
GLOBAL» al final de `styles.css`); la pantalla de acceso comparte el mismo
lenguaje visual.

El botón ☾/☀ de la barra de título alterna entre el tema claro y el oscuro
(papel oscuro, líneas claras, tipos claros y el mismo acento rojo). La elección se
guarda en `localStorage` y, si no hay ninguna, se respeta
`prefers-color-scheme`.

El botón ☰ del encabezado abre el **menú principal**. La vista principal muestra
los **canales de texto y de voz** del servidor activo —y, en la máquina
anfitriona, un botón **+ Nuevo canal** para crear canales de texto o voz—, un
botón **Servidores** y **Cerrar sesión**. El botón Servidores abre una sub-vista con
estas dos listas:

- **Mis servidores**: los creados en este nodo (el host es su dueño). Se marcan
  como *actual*, *unido* o *disponible*; si no tienes token, el menú ofrece
  unirte con tu nombre. Cada fila tiene un botón 🗑 que, tras confirmar, llama a
  `DELETE /servers/{id}`, quita la entrada del registro local y abre otro
  servidor guardado (o vuelve al inicio si era el único).
- **En los que estoy**: los servidores con token guardado. El servidor activo
  siempre aparece aquí, aunque el registro local esté desactualizado. Cada fila
  tiene un botón × para salir: pide confirmación, llama a
  `POST /servers/{id}/leave`, quita la entrada del registro y, si era el activo,
  abre otro servidor guardado o vuelve a la pantalla de conexión.

El nombre es el único dato de identidad que se edita: pulsarlo en el encabezado
del chat abre un diálogo que envía
`PATCH /me` con `{ "name": ... }`. El `nickname` interno no cambia.

**Ajustes del servidor** (botón ⚙ de la cabecera, solo desde la máquina
anfitriona) abre un
panel con tres pestañas: *General* (nombre, descripción, máximo de miembros y
encendido/apagado), *Canales* (crear, renombrar, cambiar tema y posición, y
borrar canales de texto y de llamada; el canal principal no se puede borrar) e
*Invitaciones* (crear con duración y opción de un solo uso, copiar el código y
revocarlo). Las invitaciones creadas se recuerdan en `localStorage` por servidor
porque el nodo no expone un listado de ellas.

La barra de título es propia: `decorations: false` quita los controles nativos y
`TitleBar.tsx` dibuja minimizar / maximizar-restaurar / cerrar con
`@tauri-apps/api/window`. La zona es `data-tauri-drag-region`, por lo que se
puede arrastrar la ventana desde ella. En el navegador (`npm run dev`) los
botones no hacen nada porque no hay ventana nativa.

## Estructura

| Ruta | Contenido |
|---|---|
| `client/src-tauri/` | Crate Tauri: commands `load_session`, `save_session`, `clear_session`, `read_admin_token`, `ensure_node` (arranque del nodo). |
| `client/src/api/schema.ts` | Esquemas Zod derivados de `rust/src/models/` y `docs/api.md`. |
| `client/src/api/client.ts` | Cliente HTTP: prefijo `/api/v1`, Bearer token, validación de respuestas. |
| `client/src/api/errors.ts` | Parser de `application/problem+json` y mensajes amigables. |
| `client/src/api/ws.ts` | WebSocket con reconexión, heartbeat y `channel.subscribe`. |
| `client/src/state/` | Store Zustand y persistencia de la sesión. |
| `client/src/components/` | Pantalla de conexión, chat, `MainMenu` (navegación y ajustes) y diálogos de nombre/servidor. |

## Flujo de conexión

1. La columna derecha ofrece solo dos acciones: **Unirse** o **Crear servidor**.
   - Unirse muestra solo **servidores nuevos**: excluye los borrados y los que
     ya están en el registro local de servidores unidos. En vez de un desplegable,
     el botón **Elige un servidor** abre un mosaico con esos servidores; al
     pulsar una tarjeta queda seleccionado y se cierra el mosaico. El registro se guarda
     con la sesión (`session.json` en Tauri, `localStorage` en el navegador) y
     sobrevive al cierre de sesión; las sesiones antiguas migran al iniciar.
   - Crear servidor pide nombre, identificador, descripción y tu nombre, y
     llama a `POST /servers`. Después entra automáticamente con
     `POST /servers/{id}/join`. El token de administración del nodo
     (`HAZEL_ADMIN_TOKEN` del `.env`) no se puede editar en la interfaz: el
     command `read_admin_token` lo lee automáticamente (busca desde
     `HAZEL_ENV_PATH` o sube desde el directorio actual). Si no se encuentra, el
     botón de crear queda deshabilitado; con un nodo remoto hay que crear el
     servidor con la API del nodo. El formulario valida nombre, descripción,
     identificador y tu nombre con las mismas reglas del nodo antes de enviarlos; si
     aun así llega un `request_validation_error`, la interfaz muestra el campo
     concreto en vez del mensaje genérico. Al pulsar **Crear servidor**, el command
     `ensure_node` comprueba `/health`: si el nodo no responde, ejecuta
     `python -m composer up` (Postgres, Kafka y migraciones) y luego
     `python -m composer api` en segundo plano, y espera a que esté listo antes
     de llamar a `POST /servers`.
   El token de administración nunca se guarda ni se registra; solo se usa para
   esa petición. Tras crear, el cliente se une con tu nombre y obtiene su token
   de miembro, que sirve para chatear. La gestión del servidor no depende de ese
   token: el backend exige que la petición llegue desde la máquina anfitriona
   (loopback, IP local o gateway de Docker) y devuelve `host_required` si no es
   así. `GET /api/v1/node` informa de `can_manage` para mostrar u ocultar los
   ajustes en la interfaz.
2. `POST /servers/{id}/join` devuelve un token **scope al servidor** junto con
   el miembro y un resumen del servidor.
3. Se guarda `{token, base_url}` y se abre `WS /api/v1/ws?token=...`.
4. Se cargan los canales del servidor, se suscribe al canal por defecto y se
   pide historial con `GET /channels/{id}/messages?limit=50`.

## Realtime

Los eventos llegan en el sobre `{ type, server_id, channel_id?, data }`.
El cliente aplica:

| Evento | Acción |
|---|---|
| `message.created` / `message.updated` | `data` es el mensaje completo → upsert por id. |
| `message.deleted` | `data.message_id` → marca `deleted`, contenido `null`. |
| `presence.update` | actualiza el indicador en línea del miembro. |
| `typing.start` | muestra "está escribiendo" durante 3 s. |
| `error` | muestra `data.detail` en el banner. |

El envío de `typing.start` se limita a uno cada 2 s (el servidor ya aplica su
propio rate limit por socket). El heartbeat va cada 30 s, por debajo del idle
timeout por defecto del nodo (300 s).

## Sesión y seguridad

- En Tauri: `session.json` en `app_config_dir`, con permisos `0600` en Unix.
- En navegador (`npm run dev`): `localStorage`. Es solo para desarrollo.
- El token nunca se registra en logs. `logout` lo revoca en el servidor y borra
  el archivo local.

## Alcance actual

Implementado: conexión, unión por nombre, menú único con lista de
servidores/canales, historial, envío de mensajes, presencia, "escribiendo",
reconexión y errores.

También están conectados: expulsar miembros, estadísticas y auditoría, backup y
restauración, renovación de token, cierre global de sesiones, heartbeat,
dirección compartible, canjeo de invitaciones, edición/borrado de mensajes,
reacciones, adjuntos y señalización de llamadas (`/call` + participantes). La
negociación WebRTC de audio/vídeo sigue pendiente; la señalización y la lista de
participantes ya funcionan.

## Verificación

```bash
cd client && npm run build                     # tsc + vite
cd client/src-tauri && cargo check             # requiere deps del sistema Tauri
```

El splash comprueba el 100 % de las dependencias antes de entrar al home. Si
falta algo (incluido "Docker en marcha"), el instalador elevado lo resuelve:
paquetes del sistema, Rust y, en Linux, arranque de Docker, alta del usuario en
el grupo `docker` y acceso ACL al socket. El cliente no pide al usuario que
ejecute comandos a mano ni que cierre sesión; solo muestra los comandos como
último recurso si la instalación falla.

En Linux hay que instalar antes las dependencias del sistema de Tauri. En Arch:
`sudo pacman -S webkit2gtk-4.1 libayatana-appindicator librsvg base-devel`.
Sin `webkit2gtk-4.1`, `cargo check` falla en `javascriptcore-rs-sys`; es una
dependencia del sistema, no un error del código. Los PNG de `src-tauri/icons`
deben ser RGBA (color type 6), no RGB.
