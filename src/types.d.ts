import type { AudioEngineBridge, BroadcastBridge, ControlBridge } from '../shared/contract';

declare global {
  interface Window {
    /**
     * Bridge exposed by the window's preload: ControlBridge in the Control window,
     * BroadcastBridge in the Broadcast window. Absent outside Electron.
     */
    regie?: ControlBridge | BroadcastBridge;
    /** The audio engine's bridge, in the Control window only (ADR-0002). */
    regieAudio?: AudioEngineBridge;
  }
}
