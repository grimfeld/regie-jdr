// Control window bridge: the full API (contract: ControlBridge).
// Sandboxed preload: it can only require('electron'), so contract imports are type-only and
// the small helpers below are repeated in preload-broadcast.ts.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ControlBridge,
  EventChannel,
  EventChannels,
  InvokeChannel,
  Payload,
  Result,
  Unsubscribe,
} from '../shared/contract.js';

function invoke<C extends InvokeChannel>(
  channel: C,
  ...payload: Payload<C> extends void ? [] : [Payload<C>]
): Promise<Result<C>> {
  return ipcRenderer.invoke(channel, ...payload);
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
  getDisplay: () => invoke('display:get'),
  onDisplayChanged: (listener) => subscribe('display:changed', listener),
  setDisplay: (display) => invoke('display:set', display),
  openBroadcast: () => invoke('broadcast:open'),
  importImages: () => invoke('media:import-images'),
};

contextBridge.exposeInMainWorld('regie', bridge);
