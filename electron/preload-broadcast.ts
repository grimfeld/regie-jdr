// Broadcast window bridge: read and subscribe only (contract: BroadcastBridge).
// Sandboxed preload: it can only require('electron'), so contract imports are type-only and
// the small helpers below are repeated in preload-control.ts.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  BroadcastBridge,
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

const bridge: BroadcastBridge = {
  getOnAir: () => invoke('onAir:get'),
  onOnAirChanged: (listener) => subscribe('onAir:changed', listener),
};

contextBridge.exposeInMainWorld('regie', bridge);
