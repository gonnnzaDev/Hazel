// Lo único que la ventana ve del proceso principal.
//
// La ventana corre aislada (sin Node). Este puente le da exactamente dos
// cosas: hacer peticiones HTTP a un nodo y copiar texto al portapapeles.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recopBridge', {
  request: (request) => ipcRenderer.invoke('api:request', request),
  copy: (text) => ipcRenderer.invoke('clipboard:write', String(text)),
  platform: process.platform,
});
