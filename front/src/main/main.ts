// Proceso principal de Electron: abre la ventana y hace de puente con la red.
//
// Las peticiones HTTP a los nodos y grupos salen desde acá y no desde la
// ventana. Así el cliente no depende de cómo cada dueño configuró CORS
// (RECOP_CORS_ORIGINS): una página cargada desde file:// tiene origen `null`,
// y un nodo que solo acepta orígenes conocidos la rechazaría.

import * as path from 'node:path';
import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  ipcMain,
  nativeTheme,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC, type ProxyRequest, type ProxyResponse } from '../shared/bridge';

const DEV = process.argv.includes('--dev');
const DEFAULT_TIMEOUT_MS = 10_000;

// Permisos que la ventana puede pedir. El micrófono es para los canales de voz.
const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write']);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 960,
    minHeight: 580,
    title: 'Recop',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    // El mismo fondo que la app, para que no haya un destello blanco al abrir.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#313338' : '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Los links externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Una petición HTTP en nombre de la ventana. Nunca lanza: devuelve el estado y
// el cuerpo crudo, y la ventana decide qué hacer con un 4xx o con un error de red.
async function proxyRequest(_event: IpcMainInvokeEvent, request: ProxyRequest): Promise<ProxyResponse> {
  const { url, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = request;

  if (typeof url !== 'string' || !isHttpUrl(url)) {
    return { ok: false, status: 0, error: 'invalid_url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await net.fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

void app.whenReady().then(() => {
  if (!DEV && process.platform !== 'darwin') Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  ipcMain.handle(IPC.request, proxyRequest);
  ipcMain.handle(IPC.copy, (_event, text: unknown) => {
    clipboard.writeText(String(text ?? ''));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
