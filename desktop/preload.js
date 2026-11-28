// Ponte sicuro tra l'interfaccia e le funzioni di Windows (accesso Google, rete, file).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  configured: ipcRenderer.sendSync('configured'),
  signIn: () => ipcRenderer.invoke('signIn'),
  getToken: () => ipcRenderer.invoke('getToken'),
  signOut: () => ipcRenderer.invoke('signOut'),
  http: req => ipcRenderer.invoke('http', req),
  openExternal: url => ipcRenderer.invoke('openExternal', url),
  saveFile: (name, content) => ipcRenderer.invoke('saveFile', name, content),
  coopStatus: () => ipcRenderer.invoke('coopStatus'),
  coopSave: (user, pass) => ipcRenderer.invoke('coopSave', user, pass),
  coopForget: () => ipcRenderer.invoke('coopForget'),
  coopFetch: (which, da, a) => ipcRenderer.invoke('coopFetch', which, da, a),
});
