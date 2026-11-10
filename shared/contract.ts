/**
 * The one typed contract between the windows and the main process.
 * Types only: the sandboxed preloads cannot load other modules at runtime,
 * so they import these with `import type`.
 *
 * Adding a channel: see the checklist in core/ipc.ts.
 */
import type {
  AudioRole,
  Campaign,
  CampaignId,
  ImageCategory,
  Media,
  MediaId,
  OnAirState,
  SceneId,
  ThemeId,
} from './domain.js';

/** What an import accepts: images, or audio with the role (fixed) every imported file gets. */
export type MediaImportKind = { accept: 'image' } | { accept: 'audio'; role: AudioRole };

export interface MediaImportResult {
  /** One Media per accepted file, in order; content already in the Campaign gives its Media. */
  imported: Media[];
  /** One French message per refused file (unsupported type, or not the kind asked for). */
  refused: string[];
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
  /** The Media library of a Campaign, in import order. */
  'media:list': { payload: { campaignId: CampaignId }; result: Media[] };
  /**
   * Pick files with the native file picker (the window never names files) and import them
   * into the Campaign's library. Cancelling the picker imports nothing.
   */
  'media:import': {
    payload: { campaignId: CampaignId } & MediaImportKind;
    result: MediaImportResult;
  };
  /** Change an image's category. Fails for audio: its role is fixed at import. */
  'media:set-category': {
    payload: { campaignId: CampaignId; mediaId: MediaId; category: ImageCategory };
    result: Media;
  };
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
  listMedia(campaignId: CampaignId): Promise<Media[]>;
  importMedia(campaignId: CampaignId, kind: MediaImportKind): Promise<MediaImportResult>;
  setImageCategory(
    campaignId: CampaignId,
    mediaId: MediaId,
    category: ImageCategory,
  ): Promise<Media>;
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(name: string): Promise<Campaign>;
  updateCampaign(id: CampaignId, changes: CampaignChanges): Promise<Campaign>;
  takeNotices(): Promise<string[]>;
}
