/**
 * The one typed contract between the windows and the main process.
 * Types only: the sandboxed preloads cannot load other modules at runtime,
 * so they import these with `import type`.
 *
 * Adding a channel: see the checklist in core/ipc.ts.
 */
import type { CampaignId, OnAirState, SceneId } from './domain.js';

/** Image just imported into the library (prototype shape, until Media storage lands). */
export interface ImportedImage {
  name: string;
  /** `regie-asset:` address of the stored file. */
  url: string;
}

/**
 * Request/response channels (`ipcRenderer.invoke`). `payload: void` means the call takes no
 * argument. Which window may call each one is in core/ipc.ts.
 */
export interface InvokeChannels {
  /** Read what is on air (the current snapshot). */
  'onAir:get': { payload: void; result: OnAirState };
  /** Open (or switch to) a Campaign: clears the Active Scene. */
  'onAir:open-campaign': { payload: { campaignId: CampaignId }; result: OnAirState };
  /** Close the open Campaign: nothing is on air. */
  'onAir:close-campaign': { payload: void; result: OnAirState };
  /** Activate a Scene of the open Campaign: it goes on air. Fails if no Campaign is open. */
  'onAir:activate-scene': { payload: { sceneId: SceneId }; result: OnAirState };
  /** Open the Broadcast window, or focus it if already open. */
  'broadcast:open': { payload: void; result: void };
  /** Pick images with the native file picker and copy them into the library. */
  'media:import-images': { payload: void; result: ImportedImage[] };
}

/** Main-to-window notifications (`webContents.send`), by payload type. */
export interface EventChannels {
  /** Every new on-air snapshot; a window ignores one older than what it shows. */
  'onAir:changed': OnAirState;
}

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel = keyof EventChannels;
export type Payload<C extends InvokeChannel> = InvokeChannels[C]['payload'];
export type Result<C extends InvokeChannel> = InvokeChannels[C]['result'];

/**
 * Why a window message failed: `rejected` when the sender policy or payload checks refused it
 * (core/ipc.ts), `failed` when the main process could not carry it out. Details are in the log.
 */
export type IpcFailureCode = 'rejected' | 'failed';

/**
 * What a bridge call's promise rejects with when its message fails. A plain object, not an
 * Error: an Error loses its extra fields when it crosses the bridge.
 */
export interface IpcFailure {
  kind: 'ipc-failure';
  code: IpcFailureCode;
  channel: InvokeChannel;
  /** Technical message, for the console; not meant for the Game Master. */
  message: string;
}

/** Stops a subscription. */
export type Unsubscribe = () => void;

/** Read-only bridge of the Broadcast window: read and subscribe, nothing else. */
export interface BroadcastBridge {
  getOnAir(): Promise<OnAirState>;
  onOnAirChanged(listener: (snapshot: OnAirState) => void): Unsubscribe;
}

/** Full bridge of the Control window. */
export interface ControlBridge extends BroadcastBridge {
  openCampaign(campaignId: CampaignId): Promise<OnAirState>;
  closeCampaign(): Promise<OnAirState>;
  activateScene(sceneId: SceneId): Promise<OnAirState>;
  openBroadcast(): Promise<void>;
  importImages(): Promise<ImportedImage[]>;
}
