// Control window bridge: the full API (contract: ControlBridge).
// Sandboxed preload: it can only require('electron'), so contract imports are type-only and
// the small helpers below are repeated in preload-broadcast.ts.
import { contextBridge, ipcRenderer } from 'electron';
import type {
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
  onAudioHalt: (listener) => subscribe('audio:halt', () => listener()),
  openCampaign: (campaignId) => invoke('onAir:open-campaign', { campaignId }),
  closeCampaign: () => invoke('onAir:close-campaign'),
  activateScene: (sceneId) => invoke('onAir:activate-scene', { sceneId }),
  setBlackout: (on) => invoke('onAir:set-blackout', { on }),
  listScenes: (campaignId) => invoke('scenes:list', { campaignId }),
  createScene: (campaignId, name) => invoke('scenes:create', { campaignId, name }),
  editScene: (campaignId, sceneId, edit) => invoke('scenes:edit', { campaignId, sceneId, edit }),
  openBroadcast: () => invoke('broadcast:open'),
  toggleBroadcastFullscreen: () => invoke('broadcast:toggle-fullscreen'),
  listMedia: (campaignId) => invoke('media:list', { campaignId }),
  importMedia: (campaignId, kind) => invoke('media:import', { campaignId, ...kind }),
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
};

contextBridge.exposeInMainWorld('regie', bridge);
