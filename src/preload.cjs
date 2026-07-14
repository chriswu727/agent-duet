const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("duet", {
  applyWorkspace: (id) => ipcRenderer.invoke("duet:workspace-apply", id),
  cancel: () => ipcRenderer.invoke("duet:cancel"),
  discardWorkspace: (id) => ipcRenderer.invoke("duet:workspace-discard", id),
  finalizeWorkspace: (id) => ipcRenderer.invoke("duet:workspace-finalize", id),
  health: () => ipcRenderer.invoke("duet:health"),
  history: () => ipcRenderer.invoke("duet:history"),
  historyReceipt: (id) => ipcRenderer.invoke("duet:history-read", id),
  onEvent: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("duet:event", handler);
    return () => ipcRenderer.removeListener("duet:event", handler);
  },
  selectProject: () => ipcRenderer.invoke("duet:select-project"),
  start: (config) => ipcRenderer.invoke("duet:start", config),
  undoWorkspace: (id) => ipcRenderer.invoke("duet:workspace-undo", id),
  workspaces: () => ipcRenderer.invoke("duet:workspaces")
});
