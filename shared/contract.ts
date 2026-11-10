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
  NormalizedPoint,
  OnAirState,
  Scene,
  SceneId,
  Settings,
  ThemeId,
} from './domain.js';

/**
 * One edit command on a Scene's composition, applied by the app core (core/sceneEdits.ts).
 * Plain data, so the core can keep an undo history of them.
 */
export type SceneEdit =
  /** Places an image as a new Background, on top of the stack, Hidden, covering the canvas. */
  | { kind: 'place-background'; mediaId: MediaId }
  /**
   * Places an image as a new Overlay, in front of the others, Hidden, half the canvas high,
   * centred on `position` (the canvas centre when absent).
   */
  | { kind: 'place-overlay'; mediaId: MediaId; position?: NormalizedPoint }
  /** Shows or hides a Background or Overlay. */
  | { kind: 'set-visible'; placementId: string; visible: boolean }
  /** Removes a Background or Overlay from the Scene. */
  | { kind: 'remove-placement'; placementId: string }
  /** Renames the Scene (its private name; never shown to players). */
  | { kind: 'rename'; name: string };

/** What an import accepts: images, or audio with the role (fixed) every imported file gets. */
export type MediaImportKind = { accept: 'image' } | { accept: 'audio'; role: AudioRole };

export interface MediaImportResult {
  /** One Media per accepted file, in order; content already in the Campaign gives its Media. */
  imported: Media[];
  /** One French message per refused file (unsupported type, or not the kind asked for). */
  refused: string[];
}

/**
 * Outcome of deleting a Media. Media that Scenes use is only deleted once the Game Master
 * confirms: until then `deleted` is false and `affectedScenes` lists the Scenes using it.
 * Once deleted, `affectedScenes` lists the Scenes whose placements were removed.
 */
export interface MediaDeletion {
  deleted: boolean;
  affectedScenes: { id: SceneId; name: string }[];
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
  /**
   * Start (`on`) or end Blackout: the broadcast fades to black, the Active Scene is unchanged.
   * Fails if no Campaign is open.
   */
  'onAir:set-blackout': { payload: { on: boolean }; result: OnAirState };
  /** The Scenes of a Campaign, in creation order. */
  'scenes:list': { payload: { campaignId: CampaignId }; result: Scene[] };
  /** Create an empty Scene; fails with a French message for an empty name. */
  'scenes:create': { payload: { campaignId: CampaignId; name: string }; result: Scene };
  /**
   * Apply one edit command to a Scene (core/sceneEdits.ts) and get the Scene as saved. On the
   * Active Scene the edit goes on air at once; any other Scene stays private.
   */
  'scenes:edit': {
    payload: { campaignId: CampaignId; sceneId: SceneId; edit: SceneEdit };
    result: Scene;
  };
  /**
   * Delete a Scene. When it is the Active Scene, the Active Scene is cleared: nothing of it
   * stays on air. The window asks the Game Master to confirm first.
   */
  'scenes:delete': { payload: { campaignId: CampaignId; sceneId: SceneId }; result: void };
  /** Open the Broadcast window, or focus it if already open. */
  'broadcast:open': { payload: void; result: void };
  /**
   * Put the Broadcast window in fullscreen, or take it out. Returns whether it is now
   * fullscreen (false when it is not open).
   */
  'broadcast:toggle-fullscreen': { payload: void; result: boolean };
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
  /**
   * Rename a Media: changes the name it is shown under; its original file name is kept. Fails
   * with a French message for an empty or too long name.
   */
  'media:rename': {
    payload: { campaignId: CampaignId; mediaId: MediaId; name: string };
    result: Media;
  };
  /**
   * Delete a Media. Unused Media is deleted at once. Media that Scenes use is deleted only
   * when `confirmed`; otherwise nothing changes and the result lists the Scenes using it.
   */
  'media:delete': {
    payload: { campaignId: CampaignId; mediaId: MediaId; confirmed: boolean };
    result: MediaDeletion;
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
  /**
   * The global Settings: home page theme, window bounds, and each Campaign's last Active Scene
   * (for highlighting only: nothing goes on air after a restart).
   */
  'settings:get': { payload: void; result: Settings };
  /** Change the theme of the Campaign list home page. */
  'settings:set-theme': { payload: { theme: ThemeId }; result: Settings };
}

/** Main-to-window notifications (`webContents.send`), by payload type. */
export interface EventChannels {
  /** Every new on-air snapshot; a window ignores one older than what it shows. */
  'onAir:changed': OnAirState;
  /** Halt all audio now (Campaign opened, switched or closed). For the audio engine. */
  'audio:halt': null;
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
  onAudioHalt(listener: () => void): Unsubscribe;
}

/** Full bridge of the Control window. */
export interface ControlBridge extends BroadcastBridge {
  openCampaign(campaignId: CampaignId): Promise<OnAirState>;
  closeCampaign(): Promise<OnAirState>;
  activateScene(sceneId: SceneId): Promise<OnAirState>;
  setBlackout(on: boolean): Promise<OnAirState>;
  listScenes(campaignId: CampaignId): Promise<Scene[]>;
  createScene(campaignId: CampaignId, name: string): Promise<Scene>;
  editScene(campaignId: CampaignId, sceneId: SceneId, edit: SceneEdit): Promise<Scene>;
  deleteScene(campaignId: CampaignId, sceneId: SceneId): Promise<void>;
  openBroadcast(): Promise<void>;
  toggleBroadcastFullscreen(): Promise<boolean>;
  listMedia(campaignId: CampaignId): Promise<Media[]>;
  importMedia(campaignId: CampaignId, kind: MediaImportKind): Promise<MediaImportResult>;
  setImageCategory(
    campaignId: CampaignId,
    mediaId: MediaId,
    category: ImageCategory,
  ): Promise<Media>;
  renameMedia(campaignId: CampaignId, mediaId: MediaId, name: string): Promise<Media>;
  deleteMedia(campaignId: CampaignId, mediaId: MediaId, confirmed: boolean): Promise<MediaDeletion>;
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(name: string): Promise<Campaign>;
  updateCampaign(id: CampaignId, changes: CampaignChanges): Promise<Campaign>;
  takeNotices(): Promise<string[]>;
  getSettings(): Promise<Settings>;
  setHomeTheme(theme: ThemeId): Promise<Settings>;
}
