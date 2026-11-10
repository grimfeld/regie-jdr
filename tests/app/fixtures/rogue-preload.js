// Test-only preload: stands for a compromised Broadcast window that bypasses its bridge
// and sends raw IPC messages. Registered on the session by bridges.spec.ts.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rogue', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
