# Recop — cliente de escritorio

La app para usar Recop sin `curl`. Hecha con [Electron](https://www.electronjs.org/),
con una interfaz que se parece a Discord: tus servidores a la izquierda, los canales
al lado, el chat en el medio y los miembros a la derecha.

<p align="center"><img src="assets/icon.png" width="96" alt="Recop" /></p>

---

## Arrancarlo

Necesitás [Node.js](https://nodejs.org/) 20 o más nuevo. `npm start` compila el TypeScript y abre la app.

```bash
cd front
npm install
npm start
```

O desde la raíz del repo: `make front`.

Si vas a crear servidores, antes levantá tu nodo (`make up` y `make api`, o
`docker compose up`). Para entrar al servidor de un amigo no hace falta: alcanza
con la dirección que te pasó.

---

## Cómo se usa

| Quiero… | Dónde |
|---|---|
| Crear mi servidor | Logo de arriba a la izquierda → **Crear servidor**, o el **+** |
| Pasarle la dirección a mis amigos | El ícono de copiar al lado de la dirección, o **Invitar gente** dentro del servidor |
| Entrar al servidor de alguien | **+** → **Unirme a un servidor**, y pegás `ip:puerto/nombre` |
| Encender o apagar un servidor | **Mi nodo** → **Encender** / **Apagar**. Apagar no borra nada |
| Hablar por voz | Clic en un canal con el ícono de parlante |
| Cambiar cómo me ven | Clic en tu nombre, abajo a la izquierda |
| Modo oscuro | El engranaje → **Configuración** → Tema |

No hay cuentas: entrás con un nickname. Si escribís "Ana Paula", tu nickname queda
`@ana_paula` y en el chat te ven como "Ana Paula". Si se te vence la sesión, volvés
a entrar con el mismo nickname y recuperás tu lugar.

---

## Cómo está armado

TypeScript estricto, sin frameworks: el DOM se arma con una función `h()` chica.
esbuild compila a `dist/` en milisegundos y `tsc` revisa los tipos aparte.

```
front/
├── assets/                 ícono de la app (SVG y PNG)
├── build.mjs               compila src/ → dist/ con esbuild
├── tsconfig.json           tipos de la ventana (DOM, sin Node)
└── src/
    ├── shared/bridge.ts    el contrato entre la ventana y el proceso principal
    ├── main/
    │   ├── main.ts         proceso principal: abre la ventana y hace las peticiones HTTP
    │   ├── preload.ts      el puente entre la ventana y el proceso principal
    │   └── tsconfig.json   tipos de Node y Electron
    └── renderer/
        ├── index.html
        ├── styles.css      paleta y estilos (claro y oscuro)
        ├── types.ts        el contrato de la API (copia de los schemas del backend)
        ├── util.ts         DOM, fechas, normalizar nicknames
        ├── icons.ts        íconos de línea
        ├── store.ts        preferencias y sesiones (una por servidor)
        ├── state.ts        el estado en memoria
        ├── api.ts          cliente de /api/v1
        ├── call.ts         canales de voz con WebRTC
        ├── ui.ts           modales, menús y avisos
        ├── views.ts        las cuatro columnas
        └── app.ts          acciones, sondeo y arranque
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
un archivo local, y un nodo con `RECOP_CORS_ORIGINS` restringido la rechazaría.
Pidiendo desde `main.ts` el cliente anda igual sin importar cómo configuró CORS
cada dueño.

**Por qué funciona también en un navegador.** Si no está el puente de Electron,
`api.ts` usa `fetch` directo. Para probar la interfaz sin Electron:

```bash
cd front && npm run build && python3 -m http.server 5500
# abrí http://127.0.0.1:5500/dist/renderer/index.html
```

---

## Lo que todavía no hace

- **Mensajes en tiempo real.** El backend todavía no tiene el WebSocket de chat
  (`/api/v1/ws`), así que el cliente pide los mensajes nuevos cada 2,5 segundos.
  Cuando exista, se cambia el sondeo por los eventos sin tocar las vistas.
- **Crear o editar canales.** La API todavía no tiene esos endpoints: los canales
  salen de cómo se creó el servidor (`general` y, si querés, `charla` de voz).
- **Video.** Los canales de voz son solo audio.
- **Instaladores.** Por ahora se corre con `npm start`. Empaquetarlo para Windows,
  macOS y Linux (por ejemplo con electron-builder) es el siguiente paso.

Los íconos están basados en [Feather](https://feathericons.com/) (MIT).
