// Kew for Windows — preload bridge. Cybergah Group.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kew", {
  info: (url) => ipcRenderer.invoke("kew:info", url),
  playlist: (url) => ipcRenderer.invoke("kew:playlist", url),
  download: (opts) => ipcRenderer.invoke("kew:download", opts),
  cancel: (taskId) => ipcRenderer.invoke("kew:cancel", taskId),
  openPath: (p) => ipcRenderer.invoke("kew:openPath", p),
  notify: (title) => ipcRenderer.invoke("kew:notify", title),
  onProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("kew:progress", h);
    return () => ipcRenderer.removeListener("kew:progress", h);
  },
});
