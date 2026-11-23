# Cliente de escritorio (Tauri)

Cliente de Hazel para PC: **Tauri 2 + React 19 + TypeScript + Zod + Zustand**.
Vive en `client/` y es independiente del crate del nodo (`rust/`).

## Requisitos

- Node.js 20+ y npm
- Rust 1.77+
- Dependencias del sistema de Tauri (en Debian/Ubuntu):
  `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `patchelf`

## Desarrollo

```bash
cd client
npm install
npm run tauri dev        # abre la ventana con el frontend en caliente
```

Para trabajar solo en la interfaz (sin ventana nativa):

```bash
cd client
npm run dev              # http://localhost:1420
npm run build            # tsc --noEmit && vite build
```

Para generar el instalador:

```bash
cd client
npm run tauri build
```

## Qué hace ya

- Detecta la dirección del nodo (`GET /node/address`) y muestra candidatos.
- Lista servidores y permite unirse con apodo (`POST /servers/{id}/join`).
- Guarda el token en un archivo `0600` del directorio de configuración de la
  app (o `localStorage` si se abre con `npm run dev` en el navegador).
- Carga historial paginado, envía mensajes y muestra presencia y "escribiendo".
- Menú único (☰ en la cabecera) con servidores, canales, cambio de nombre,
  ajustes del servidor (solo en el host) y cierre de sesión.
- WebSocket con reconexión exponencial y heartbeat cada 30 s.
- Parsea errores `application/problem+json` y muestra mensajes en español.

## Qué NO hace todavía

- Voz/WebRTC (la API tiene signaling, pero el cliente aún no lo consume).
- Subida/descarga de archivos.
- Administración desde otro equipo: crear canales, invitaciones y ajustar el
  servidor solo funciona en la máquina anfitriona. No hay gestión de roles ni
  backups en la interfaz.
- Varias sesiones a la vez: el token es **por servidor**. Desde el menú se puede
  cambiar entre servidores ya unidos usando su token guardado.

La referencia completa está en [`docs/client.md`](../docs/client.md).
