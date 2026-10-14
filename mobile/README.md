# Recop móvil

Cliente para Android e iOS (y web, para probar rápido) con estética de tiling
WM tipo Hyprland: vidrio esmerilado, acentos neón, una barra estilo Waybar
arriba y un dock flotante abajo.

Hoy funciona **completo sin backend**: servidores, canales, chat, hilos, DMs,
amigos, voz y perfil corren sobre datos de prueba (`mocks/`). Las capas
`api/socket.ts`, `api/client.ts` y `api/voice.ts` están listas para enchufar el
nodo real.

## Correrlo

Necesitás Node 20.19 o más nuevo.

```bash
cd mobile
npm install
npx expo start
```

- **En el teléfono:** instalá Expo Go y escaneá el QR que muestra la terminal.
  Todo lo que usa la app (Reanimated, Gesture Handler, Blur, Haptics, Battery)
  viene incluido en Expo Go.
- **Emulador:** `a` en la terminal abre Android, `i` abre el simulador de iOS (en macOS).
- **En el navegador:** `w`, o `npm run web`. Sirve para ver las pantallas
  rápido; la vibración y el blur de Android solo se notan en el teléfono.

El login es de prueba: cualquier usuario y una contraseña de 4 caracteres o más.

## Qué hay

| Pantalla | Qué tiene |
|---|---|
| Arranque | Log de "boot" estilo terminal (tocá para saltarlo) |
| Login / registro | Usuario con las mismas reglas que un nickname de Recop; después elegís con qué servidor arrancar |
| Home | Dock de servidores a la izquierda con indicador neón y badges, banner del servidor y canales colapsables por categoría (texto, voz y anuncios) |
| Chat | Markdown (negrita, cursiva, `código`, bloques de código, citas), menciones `@`, emojis `:nombre:`, comandos `/`, respuestas, reacciones, hilos, "está escribiendo…" y paginación hacia arriba |
| DMs | Conversaciones, amigos en línea o todos, solicitudes y búsqueda |
| Voz | Canales para entrar; adentro, el HUD de la sala con una onda por persona, un anillo verde para quien habla, silenciar, ensordecer y la latencia |
| Perfil | Banner, avatar, estado personalizado, actividad tipo Rich Presence y los widgets de red y CPU (simulada) |
| Menciones | Todo lo que te nombró con `@` |

La paleta tipo Wofi/Rofi busca servidores, canales, gente y acciones. Se abre
con el botón flotante ⌘, manteniendo apretado "home" en el dock o con
`Ctrl/Cmd + K` en web.

## Estructura

```
app/                 rutas (Expo Router)
  (auth)/            login, registro y primer servidor
  (tabs)/            home, dms, voz y perfil, con el dock como barra de tabs
  channel/[id].tsx   chat de un canal
  dm/[id].tsx        mensaje directo (id = dm-<usuario>)
  thread/[id].tsx    hilo
  mentions.tsx       menciones
components/          piezas reutilizables: ServerRail, ChannelList, MessageItem,
                     VoiceTile, UserAvatar, WaybarHeader, WofiSearch, Dock…
  ui/                primitivas: Glass, Sheet, Touchable, NeonButton, Field…
  sheets/            hojas inferiores: perfil, canal, mensaje, miembros, ajustes…
  widgets/           monitor de red y de CPU
store/               estado global con Zustand (persistido con AsyncStorage)
hooks/               tiempo real, haptics, batería, atajos, reloj
api/                 tipos, socket, cliente REST y motor de voz
mocks/               gente, servidores, mensajes, emojis y comandos de prueba
lib/                 markdown, búsqueda difusa, formato de fechas
theme.ts             colores, radios, resortes y tipografías (los usa tailwind.config.ts)
```

## Conectar el backend

Todo lo que viene del servidor pasa por `api/`. Para usar un nodo real:

```bash
EXPO_PUBLIC_RECOP_API_URL=http://192.168.1.50:7273 \
EXPO_PUBLIC_RECOP_WS_URL=ws://192.168.1.50:7273/api/v1/ws \
npx expo start
```

- `EXPO_PUBLIC_RECOP_WS_URL` cambia el `MockSocket` por `RecopSocket`, que
  traduce los eventos del WebSocket documentado en `docs/api.md` (mensajes,
  "escribiendo", presencia). **Ese WebSocket todavía no está implementado en el
  backend**, así que por ahora conviene dejarlo sin definir.
- `api/client.ts` tiene las llamadas REST (servidores, entrar con un nickname,
  miembros, mensajes) con los mismos tipos que el backend. Los stores todavía
  usan las acciones de prueba; pasar al backend es reemplazarlas por estas.
- La voz de verdad necesita `react-native-webrtc`, que no viene en Expo Go:
  hace falta un development build (`npx expo run:android`). El protocolo de
  señalización ya está implementado en `front/src/renderer/call.ts` y se puede
  portar detrás de la interfaz `VoiceEngine` de `api/voice.ts`.

## Diferencias con lo pedido

- **Reanimated 4** en vez de 3: el SDK 57 de Expo ya no soporta la versión 3.
  La API que se usa (`useSharedValue`, `withSpring`, `entering`) es la misma.
- **Cuentas:** Recop no tiene cuentas globales, cada servidor te da un token
  al entrar con un nickname. El login de la app es de prueba y la idea es que,
  con el backend real, "entrar" sea elegir un servidor y un nickname.
- **Voz:** el backend hace WebRTC entre pares, no LiveKit. La capa de voz
  admite cualquiera de los dos.

## Chequeos

```bash
npm run typecheck     # TypeScript estricto
npm run export:web    # compila el bundle web en dist/
```
