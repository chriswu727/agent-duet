const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("duet", {
  cancel: () => ipcRenderer.invoke("duet:cancel"),
  health: () => ipcRenderer.invoke("duet:health"),
  onEvent: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("duet:event", handler);
    return () => ipcRenderer.removeListener("duet:event", handler);
  },
  selectProject: () => ipcRenderer.invoke("duet:select-project"),
  start: (config) => ipcRenderer.invoke("duet:start", config)
});
