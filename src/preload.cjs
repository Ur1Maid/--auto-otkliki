// src/preload.cjs — контекстно-изолированный мост рендерера панели к main-процессу (IPC).
//
// CommonJS (не ESM) — Electron preload-скрипты грузятся через require() до включения
// contextIsolation-совместимого ESM-раннера. window.api — единственный канал рендерера
// наружу; сам preload не трогает fs/сеть напрямую.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  metrics: () => ipcRenderer.invoke('dash:metrics'),
  live: () => ipcRenderer.invoke('dash:live'),
  accounts: () => ipcRenderer.invoke('dash:accounts'),
  tasks: () => ipcRenderer.invoke('dash:tasks'),
  start: (payload) => ipcRenderer.invoke('dash:start', payload),
  stop: (payload) => ipcRenderer.invoke('dash:stop', payload),
  loginDone: (payload) => ipcRenderer.invoke('dash:login-done', payload),
  onLiveUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('dash:live-update', handler);
    return () => ipcRenderer.removeListener('dash:live-update', handler);
  },
});
