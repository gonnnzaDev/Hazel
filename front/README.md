# Recop — cliente de escritorio

La app para usar Recop sin `curl`. Hecha con [Electron](https://www.electronjs.org/),
con una interfaz que se parece a Discord: tus servidores a la izquierda, los canales
al lado, el chat en el medio y los miembros a la derecha.

<p align="center"><img src="assets/icon.png" width="96" alt="Recop" /></p>

---

## Arrancarlo

Necesitás [Node.js](https://nodejs.org/) 20 o más nuevo.

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

Sin frameworks ni bundler: HTML, CSS y JavaScript plano, para que cualquiera lo
pueda leer y tocar.

```
front/
├── assets/                 ícono de la app (SVG y PNG)
└── src/
    ├── main.js             proceso principal: abre la ventana y hace las peticiones HTTP
    ├── preload.js          el puente entre la ventana y el proceso principal
    └── renderer/
        ├── index.html
        ├── styles.css      paleta y estilos (claro y oscuro)
        └── js/
            ├── util.js     DOM, fechas, normalizar nicknames
            ├── icons.js    íconos de línea
            ├── store.js    preferencias y sesiones (una por servidor)
            ├── api.js      cliente de /api/v1
            ├── call.js     canales de voz con WebRTC
            ├── ui.js       modales, menús y avisos
            ├── views.js    las cuatro columnas
            └── app.js      estado, acciones y sondeo
```

**Por qué las peticiones salen del proceso principal.** La ventana se carga desde
un archivo local, y un nodo con `RECOP_CORS_ORIGINS` restringido la rechazaría.
Pidiendo desde `main.js` el cliente anda igual sin importar cómo configuró CORS
cada dueño.

**Por qué funciona también en un navegador.** Si no está el puente de Electron,
`api.js` usa `fetch` directo. Para probar la interfaz sin Electron:

```bash
cd front && python3 -m http.server 5500
# abrí http://127.0.0.1:5500/src/renderer/index.html
```

`npm run dev` abre la app con las herramientas de desarrollo.

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
