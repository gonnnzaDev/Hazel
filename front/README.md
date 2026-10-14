<<<<<<< HEAD
# Hazel — cliente de escritorio

La app para usar Hazel sin `curl`. Hecha con [Electron](https://www.electronjs.org/),
con una interfaz que se parece a Discord: tus servidores a la izquierda, los canales
al lado, el chat en el medio y los miembros a la derecha.
=======
# Hazel — app de escritorio

La app para usar Hazel sin `curl`. Hecha con [Electron](https://www.electronjs.org/),
React y TypeScript, con estética de tiling WM tipo Hyprland: fondo oscuro con
grilla y partículas, paneles de vidrio en mosaico, acentos neón, una barra estilo
Waybar arriba y un dock de servidores a la izquierda.

Todo lo que muestra es real: habla con tu nodo y con los nodos de otras personas.
No hay datos de prueba.
>>>>>>> pr-19

<p align="center"><img src="assets/icon.png" width="96" alt="Hazel" /></p>

---

## Arrancarlo

Necesitás [Node.js](https://nodejs.org/) 20.19 o más nuevo. `npm start` compila y abre la app.

```bash
cd front
npm install
npm start
```

Si vas a crear servidores, antes levantá tu nodo (`make up` y
`uv run python -m core node`, o `docker compose up`). Para entrar al servidor
de un amigo no hace falta: alcanza con la dirección que te pasó.

En Linux, si la app no abre y se queja de `chrome-sandbox`, arrancala con
`npm run build && npx electron . --no-sandbox`.

---

## Qué tiene

| Parte | Qué hace |
|---|---|
| Arranque | Log estilo terminal con los pasos reales: nodo, servidores, sesiones, chat y micrófono |
| Waybar | Un espacio de trabajo por servidor (Ctrl+1…9; Ctrl+0 vuelve a tu nodo), reloj, llamada en curso, gente conectada por P2P, latencia medida contra el nodo, CPU y batería de la compu, menciones |
| Mi nodo | Crear, encender, apagar y borrar tus servidores; copiar la dirección para invitar; entrar con un nickname; widgets de latencia y de CPU y memoria |
| Dock | Tus servidores con indicador neón, no leídos, menciones y si estás en una llamada |
| Servidor | Banner, canales de texto y de voz colapsables, quién está en cada canal de voz, mensajes directos y tu barra (estado, micrófono, auriculares) |
| Chat | Markdown (negrita, cursiva, tachado, `código`, bloques de código, citas, links), menciones `@nickname` resaltadas, emojis `:nombre:`, respuestas, reacciones, borrar lo propio, "escribiendo…" y autocompletado de `/`, `:` y `@` |
| Comandos | `/help`, `/ping`, `/shrug`, `/tableflip`, `/unflip`, `/me`, `/status`, `/nick`, `/clear` |
| Miembros | Por rol (dueño, admins, miembros), los conectados primero, con su estado. El dueño puede hacer admin o echar gente |
| Voz | Una tarjeta por persona con la onda de su audio real, un anillo cuando habla, su micrófono y la latencia con cada uno. Silenciar (Ctrl+Shift+M), ensordecer y salir |
| Paleta | Ctrl+K o el botón flotante: búsqueda difusa de acciones, servidores, canales y gente |
| Avisos | Notificaciones del sistema cuando te mencionan o te escriben por privado y no estás mirando |

No hay cuentas: entrás con un nickname. Si se te vence la sesión, volvés a entrar
con el mismo nickname y recuperás tu lugar.

---

## Cómo viaja el chat

El backend todavía no guarda mensajes, pero sí presenta a la gente: su WebSocket
de llamadas (`/servers/{id}/channels/{id}/call`) acepta cualquier canal. La app
entra a la "sala" del canal de texto por defecto de cada servidor y abre un canal
de datos WebRTC con cada persona conectada. Por ahí van los mensajes de todos los
canales, las reacciones, quién está escribiendo, el estado de cada uno y los
mensajes directos (que van solo a la otra persona).

Cada app guarda el historial que vio, en esa compu. Cuando dos apps se conectan,
cada una le manda a la otra lo que le falta. Así, quien llega ve lo que se habló
mientras no estaba, **siempre que alguien que lo vio esté conectado**. Si no hay
nadie más, el mensaje queda en tu app y se entrega cuando alguien entre mientras
vos estés.

El día que el backend guarde mensajes, el único archivo a cambiar es
`src/renderer/net/bus.ts`.

---

## Cómo está armado

```
front/
├── assets/                  ícono de la app (SVG y PNG)
├── build.mjs                compila src/ → dist/ con esbuild (y copia las tipografías)
├── tsconfig.json            tipos de la ventana (DOM, sin Node)
└── src/
    ├── shared/bridge.ts     el contrato entre la ventana y el proceso principal
    ├── main/
    │   ├── main.ts          proceso principal: ventana, peticiones HTTP y uso de CPU
    │   ├── preload.ts       el puente entre la ventana y el proceso principal
    │   └── tsconfig.json    tipos de Node y Electron
    └── renderer/
        ├── index.html
        ├── main.tsx         entrada de la ventana
        ├── styles.css       el tema completo
        ├── actions.ts       todo lo que la app hace: nodo, servidores, sesiones, chat, voz
        ├── lib/             cliente de /api/v1, tipos, markdown, búsqueda difusa, colores
        ├── net/             mesh.ts (sala WebRTC), bus.ts (chat P2P), voice.ts (voz)
        ├── store/           estado con zustand: settings, sessions, app, chat, voice
        └── components/      Waybar, Dock, Sidebar, Chat, Members, Voice, Wofi, Modals…
```

| Comando | Qué hace |
|---|---|
| `npm start` | Compila y abre la app |
| `npm run dev` | Igual, con las herramientas de desarrollo abiertas |
| `npm run build` | Solo compila a `dist/` |
| `npm run typecheck` | Revisa los tipos de la ventana y del proceso principal |

La ventana y el proceso principal tienen configuraciones de tipos separadas: la
ventana no puede usar nada de Node (corre aislada) y el chequeo lo hace cumplir.

**Por qué las peticiones salen del proceso principal.** La ventana se carga desde
un archivo local, y un nodo con `HAZEL_CORS_ORIGINS` restringido la rechazaría.
Pidiendo desde `main.ts` el cliente anda igual sin importar cómo configuró CORS
cada dueño.

**Por qué todo va por la dirección del nodo.** El nodo sirve la API completa,
también la de cada servidor, así que la app no necesita saber en qué puerto
corre cada proceso de grupo. La dirección para invitar es `ip-del-nodo:puerto/slug`.

---

## Lo que todavía no hace

- **Historial en el servidor.** Mientras el backend no guarde mensajes, lo que se
  habló solo lo puede pasar alguien que lo vio y está conectado.
- **Crear o editar canales.** La API todavía no tiene esos endpoints: los canales
  salen de cómo se creó el servidor (`general` y `Charla` de voz).
- **Video.** Los canales de voz son solo audio.
- **Instaladores.** Por ahora se corre con `npm start`. Empaquetarlo para Windows,
  macOS y Linux (por ejemplo con electron-builder) es el siguiente paso.

Las tipografías son [JetBrains Mono](https://www.jetbrains.com/lp/mono/) e
[Inter](https://rsms.me/inter/) (OFL) y los íconos, [Feather](https://feathericons.com/) (MIT).
