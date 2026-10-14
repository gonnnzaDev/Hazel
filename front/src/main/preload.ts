// Lo único que la ventana ve del proceso principal.
//
// La ventana corre aislada (sin Node). Este puente le da exactamente dos
// cosas: hacer peticiones HTTP a un nodo y copiar texto al portapapeles.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ProxyRequest, type RecopBridge } from '../shared/bridge';

const bridge: RecopBridge = {
  request: (request: ProxyRequest) => ipcRenderer.invoke(IPC.request, request),
  copy: (text: string) => ipcRenderer.invoke(IPC.copy, String(text)),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('recopBridge', bridge);
