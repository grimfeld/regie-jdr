/**
 * The one typed contract between the windows and the main process.
 * Types only: the sandboxed preloads cannot load other modules at runtime,
 * so they import these with `import type`.
 *
 * Adding a channel: see the checklist in core/ipc.ts.
 */
import type { Campaign, CampaignId, ThemeId } from './domain.js';

/** Image just imported into the library (prototype shape, until Media storage lands). */
export interface ImportedImage {
  name: string;
  /** `regie-asset:` address of the stored file. */
  url: string;
}

/**
 * What the Broadcast window currently shows (prototype shape: one background,
 * a title and a description). Replaced by the on-air state snapshot later.
 */
export interface BroadcastDisplay {
  title: string;
  /** `regie-asset:` address, or '' for none. */
  background: string;
  description: string;
}

/** What can be changed on a Campaign; absent fields are left as they are. */
export interface CampaignChanges {
  name?: string;
  theme?: ThemeId;
}

/**
 * Request/response channels (`ipcRenderer.invoke`). `payload: void` means the call takes no
 * argument. Which window may call each one is in core/ipc.ts.
 */
export interface InvokeChannels {
  /** Read what the Broadcast window shows. */
  'display:get': { payload: void; result: BroadcastDisplay };
  /** Change what the Broadcast window shows. */
  'display:set': { payload: BroadcastDisplay; result: void };
  /** Open the Broadcast window, or focus it if already open. */
  'broadcast:open': { payload: void; result: void };
  /** Pick images with the native file picker and copy them into the library. */
  'media:import-images': { payload: void; result: ImportedImage[] };
  /** Every Campaign, sorted by name. */
  'campaigns:list': { payload: void; result: Campaign[] };
  /** Create a Campaign; fails with a French message for an empty name. */
  'campaigns:create': { payload: { name: string }; result: Campaign };
  /** Rename a Campaign or change its theme. */
  'campaigns:update': { payload: { id: CampaignId; changes: CampaignChanges }; result: Campaign };
  /**
   * Messages for the Game Master gathered since the last call (e.g. a corrupt file recovered
   * from its backup), in French. Returns them once.
   */
  'notices:take': { payload: void; result: string[] };
}

/** Main-to-window notifications (`webContents.send`), by payload type. */
export interface EventChannels {
  'display:changed': BroadcastDisplay;
}

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel = keyof EventChannels;
export type Payload<C extends InvokeChannel> = InvokeChannels[C]['payload'];
export type Result<C extends InvokeChannel> = InvokeChannels[C]['result'];

/** Stops a subscription. */
export type Unsubscribe = () => void;

/** Read-only bridge of the Broadcast window: read and subscribe, nothing else. */
export interface BroadcastBridge {
  getDisplay(): Promise<BroadcastDisplay>;
  onDisplayChanged(listener: (display: BroadcastDisplay) => void): Unsubscribe;
}

/** Full bridge of the Control window. */
export interface ControlBridge extends BroadcastBridge {
  setDisplay(display: BroadcastDisplay): Promise<void>;
  openBroadcast(): Promise<void>;
  importImages(): Promise<ImportedImage[]>;
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(name: string): Promise<Campaign>;
  updateCampaign(id: CampaignId, changes: CampaignChanges): Promise<Campaign>;
  takeNotices(): Promise<string[]>;
}
