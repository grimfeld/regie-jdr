import { contextBridge, ipcRenderer } from 'electron';

type ImportedAsset = { name: string; url: string };

contextBridge.exposeInMainWorld('regie', {
  openStage: () => ipcRenderer.invoke('stage:open') as Promise<boolean>,
  importImages: () => ipcRenderer.invoke('media:import-images') as Promise<ImportedAsset[]>,
  updateScene: (scene: unknown) => ipcRenderer.send('scene:update', scene),
  onSceneUpdated: (callback: (scene: unknown) => void) => {
    ipcRenderer.on('scene:updated', (_event, scene) => callback(scene));
  },
  toggleStageFullscreen: () => ipcRenderer.send('stage:fullscreen')
});
