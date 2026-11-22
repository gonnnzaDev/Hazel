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

La interfaz es **moderna y minimalista**, sin bordes decorativos: los paneles
se distinguen solo por su tono de fondo (riel más oscuro, barra lateral, área
de chat y barra inferior). Tipografía del sistema, acento índigo→violeta,
esquinas redondeadas y microinteracciones discretas. Los mensajes llevan avatar
de inicial y la píldora de estado usa un punto de color. No se cargan fuentes
externas: la app funciona sin conexión. La ventana de Tauri se declara
`transparent: true` para que el WebView deje ver el fondo del sistema.

En Linux, el desenfoque del escritorio lo hace el compositor, no Tauri. En KDE
Plasma hay que activar el efecto **Blur** de KWin (`blurEnabled=true` en
`~/.config/kwinrc`, apartado `[Plugins]`) y ajustar `BlurStrength` en
`[Effect-Blur]`. En X11 el equivalente es `picom` con `blur-background = true`.

La pantalla de acceso no usa tarjeta: ocupa toda la ventana en dos columnas
(identidad y pasos a la izquierda, acciones a la derecha) y se apila en una sola
columna por debajo de 900 px. No muestra la dirección del nodo: el cliente usa
la dirección por defecto (`http://127.0.0.1:7272`, definida en `store.ts`).

La barra de título es propia: `decorations: false` quita los controles nativos y
`TitleBar.tsx` dibuja minimizar / maximizar-restaurar / cerrar con
`@tauri-apps/api/window`. La zona es `data-tauri-drag-region`, por lo que se
puede arrastrar la ventana desde ella. En el navegador (`npm run dev`) los
botones no hacen nada porque no hay ventana nativa.

## Estructura

| Ruta | Contenido |
|---|---|
| `client/src-tauri/` | Crate Tauri: commands `load_session`, `save_session`, `clear_session`. |
| `client/src/api/schema.ts` | Esquemas Zod derivados de `rust/src/models/` y `docs/api.md`. |
| `client/src/api/client.ts` | Cliente HTTP: prefijo `/api/v1`, Bearer token, validación de respuestas. |
| `client/src/api/errors.ts` | Parser de `application/problem+json` y mensajes amigables. |
| `client/src/api/ws.ts` | WebSocket con reconexión, heartbeat y `channel.subscribe`. |
| `client/src/state/` | Store Zustand y persistencia de la sesión. |
| `client/src/components/` | Pantalla de conexión, riel de servidores, canales y chat. |

## Flujo de conexión

1. La columna derecha ofrece solo dos acciones: **Unirse** o **Crear servidor**.
   - Unirse muestra la lista de servidores y el formulario de apodo.
   - Crear servidor pide el token de administración del nodo (`HAZEL_ADMIN_TOKEN`
     del `.env`), nombre, identificador, descripción y apodo del dueño, y llama a
     `POST /servers`. Después entra automáticamente con `POST /servers/{id}/join`.
     El command `read_admin_token` rellena el token automáticamente leyendo el
     `.env` local (busca desde `HAZEL_ENV_PATH` o sube desde el directorio
     actual); si el nodo está en otra PC, hay que pegarlo a mano.
   El token de administración nunca se guarda ni se registra; solo se usa para
   esa petición. Tras crear, el cliente se une con el apodo del dueño y obtiene
   su token de miembro, que es también la credencial de administración de ese
   servidor: el backend acepta el token del dueño en lugar del secreto del nodo
   para editar, activar, hacer backup o borrar ese servidor.
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

Implementado: conexión, unión por apodo, lista de servidores/canales, historial,
envío de mensajes, presencia, "escribiendo", reconexión y errores.

Pendiente: voz (WebRTC sobre el signaling de `/call`), archivos, administración
y soporte de varias sesiones de servidor simultáneas (hoy el token es por
servidor, así que cambiar de servidor implica unirse de nuevo).

## Verificación

```bash
cd client && npm run build                     # tsc + vite
cd client/src-tauri && cargo check             # requiere deps del sistema Tauri
```

En Linux hay que instalar antes las dependencias del sistema de Tauri. En Arch:
`sudo pacman -S webkit2gtk-4.1 libayatana-appindicator librsvg base-devel`.
Sin `webkit2gtk-4.1`, `cargo check` falla en `javascriptcore-rs-sys`; es una
dependencia del sistema, no un error del código. Los PNG de `src-tauri/icons`
deben ser RGBA (color type 6), no RGB.
