// Control window bridges: the full API (contract: ControlBridge) and, beside it in the same page,
// the audio engine's (contract: AudioEngineBridge), which can only receive the mix and pad
// commands and report what sounds. Any code of the page can reach both: the engine's bridge is
// a narrow API, not a boundary (ADR-0002 put the engine in the Control window).
// Sandboxed preload: it can only require('electron'), so contract imports are type-only and
// the small helpers below are repeated in preload-broadcast.ts.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AudioEngineBridge,
  ControlBridge,
  EventChannel,
  EventChannels,
  InvokeChannel,
  IpcFailure,
  Payload,
  Result,
  Unsubscribe,
} from '../shared/contract.js';

/** The typed failure for an error thrown by registerHandlers (electron/ipc.ts). */
function failureOf(channel: InvokeChannel, error: unknown): IpcFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes('IPC message rejected') ? 'rejected' : 'failed';
  return { kind: 'ipc-failure', code, channel, message };
}

/** Calls a channel; a failed call rejects with an IpcFailure. */
function invoke<C extends InvokeChannel>(
  channel: C,
  ...payload: Payload<C> extends void ? [] : [Payload<C>]
): Promise<Result<C>> {
  return ipcRenderer.invoke(channel, ...payload).catch((error: unknown) => {
    throw failureOf(channel, error);
  });
}

/** Passes only the payload to `listener`, never the raw IPC event. */
function subscribe<E extends EventChannel>(
  channel: E,
  listener: (payload: EventChannels[E]) => void,
): Unsubscribe {
  const forward = (_event: unknown, payload: EventChannels[E]) => listener(payload);
  ipcRenderer.on(channel, forward);
  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

const bridge: ControlBridge = {
  getOnAir: () => invoke('onAir:get'),
  onOnAirChanged: (listener) => subscribe('onAir:changed', listener),
  openCampaign: (campaignId) => invoke('onAir:open-campaign', { campaignId }),
  closeCampaign: () => invoke('onAir:close-campaign'),
  activateScene: (sceneId, options) =>
    invoke('onAir:activate-scene', { sceneId, ...(options?.forceCut && { forceCut: true }) }),
  setBlackout: (on) => invoke('onAir:set-blackout', { on }),
  listScenes: (campaignId) => invoke('scenes:list', { campaignId }),
  createScene: (campaignId, name) => invoke('scenes:create', { campaignId, name }),
  editScene: (campaignId, sceneId, edit) => invoke('scenes:edit', { campaignId, sceneId, edit }),
  showTransientEdit: (campaignId, sceneId, edit) =>
    invoke('scenes:show-transient', { campaignId, sceneId, edit }),
  getUndoState: (campaignId, sceneId) => invoke('scenes:undo-state', { campaignId, sceneId }),
  undoSceneEdit: (campaignId, sceneId) => invoke('scenes:undo', { campaignId, sceneId }),
  redoSceneEdit: (campaignId, sceneId) => invoke('scenes:redo', { campaignId, sceneId }),
  deleteScene: (campaignId, sceneId) => invoke('scenes:delete', { campaignId, sceneId }),
  moveScene: (campaignId, sceneId, toIndex) =>
    invoke('scenes:move', { campaignId, sceneId, toIndex }),
  duplicateScene: (campaignId, sceneId) => invoke('scenes:duplicate', { campaignId, sceneId }),
  openBroadcast: () => invoke('broadcast:open'),
  toggleBroadcastFullscreen: () => invoke('broadcast:toggle-fullscreen'),
  listMedia: (campaignId) => invoke('media:list', { campaignId }),
  importMedia: (campaignId, kind) => invoke('media:import', { campaignId, ...kind }),
  // Only files the Game Master really dropped have a path; files made by the page have none.
  importDroppedMedia: (campaignId, files, kind) =>
    invoke('media:import-dropped', {
      campaignId,
      files: files.map((file) => webUtils.getPathForFile(file)).filter((file) => file !== ''),
      ...kind,
    }),
  // The page hands over the pasted File; the main process checks what its content is.
  importPastedImage: async (campaignId, file) =>
    invoke('media:import-pasted', {
      campaignId,
      data: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
    }),
  setImageCategory: (campaignId, mediaId, category) =>
    invoke('media:set-category', { campaignId, mediaId, category }),
  renameMedia: (campaignId, mediaId, name) => invoke('media:rename', { campaignId, mediaId, name }),
  deleteMedia: (campaignId, mediaId, confirmed) =>
    invoke('media:delete', { campaignId, mediaId, confirmed }),
  listCampaigns: () => invoke('campaigns:list'),
  createCampaign: (name) => invoke('campaigns:create', { name }),
  updateCampaign: (id, changes) => invoke('campaigns:update', { id, changes }),
  takeNotices: () => invoke('notices:take'),
  getSettings: () => invoke('settings:get'),
  setHomeTheme: (theme) => invoke('settings:set-theme', { theme }),
  setFadeDuration: (fadeDurationMs) => invoke('settings:set-fade-duration', { fadeDurationMs }),
  setMasterVolume: (masterVolume) => invoke('settings:set-master-volume', { masterVolume }),
  getSounding: () => invoke('audio:get-sounding'),
  setSilence: (on) => invoke('audio:set-silence', { on }),
  toggleSilence: () => invoke('audio:toggle-silence'),
  onSoundingChanged: (listener) => subscribe('audio:sounding-changed', listener),
  getSoundboard: (campaignId) => invoke('soundboard:get', { campaignId }),
  editSoundboard: (campaignId, edit) => invoke('soundboard:edit', { campaignId, edit }),
  pressPad: (campaignId, padId) => invoke('soundboard:press', { campaignId, padId }),
  showSoundboardTransient: (campaignId, edit) =>
    invoke('soundboard:show-transient', { campaignId, edit }),
  pickMusic: (mediaId) => invoke('audio:pick-music', { mediaId }),
  setMusicPlayback: (playback) => invoke('audio:set-music-playback', { playback }),
};

// The audio engine's bridge: tests/unit/bridges.test.ts checks it calls nothing else.
const audioEngine: AudioEngineBridge = {
  getMix: () => invoke('audio:get-mix'),
  onMixChanged: (listener) => subscribe('audio:mix-changed', listener),
  report: (report) => invoke('audio:report', report),
  onPadCommand: (listener) => subscribe('audio:pad-command', listener),
  reportPads: (report) => invoke('audio:report-pads', report),
};

contextBridge.exposeInMainWorld('regie', bridge);
contextBridge.exposeInMainWorld('regieAudio', audioEngine);
