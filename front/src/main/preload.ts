// Lo único que la ventana ve del proceso principal.
//
// La ventana corre aislada (sin Node). Este puente le da exactamente tres
// cosas: hacer peticiones HTTP a un nodo, copiar texto al portapapeles y leer
// el uso de CPU y memoria de la máquina.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ProxyRequest, type HazelBridge } from '../shared/bridge';

const bridge: HazelBridge = {
  request: (request: ProxyRequest) => ipcRenderer.invoke(IPC.request, request),
  copy: (text: string) => ipcRenderer.invoke(IPC.copy, String(text)),
  stats: () => ipcRenderer.invoke(IPC.stats),
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
};

contextBridge.exposeInMainWorld('hazelBridge', bridge);
