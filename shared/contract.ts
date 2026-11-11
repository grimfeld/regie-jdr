/**
 * The one typed contract between the windows and the main process.
 * Types only: the sandboxed preloads cannot load other modules at runtime,
 * so they import these with `import type`.
 *
 * Adding a channel: see the checklist in core/ipc.ts.
 */
import type {
  AudioEngineReport,
  AudioMix,
  AudioRole,
  AudioSounding,
  BackgroundFit,
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
  /**
   * Moves a Background to `toIndex` in the stack (0 is the bottom; past the top stays on top),
   * so it covers the ones below it.
   */
  | { kind: 'move-background'; placementId: string; toIndex: number }
  /** Sets a Background to Cover or Contain, keeping its Cover zoom and focal point. */
  | { kind: 'set-background-fit'; placementId: string; fit: BackgroundFit }
  /**
   * Frames a Background in Cover: sets its zoom (kept within limits) and either coordinate of
   * its focal point, each only when given, so one slider never overwrites another's change.
   */
  | {
      kind: 'frame-background';
      placementId: string;
      zoom?: number;
      focus?: Partial<NormalizedPoint>;
    }
  /**
   * Moves and/or resizes an Overlay (a drag, a resize, or a burst of arrow-key nudges): sets
   * either coordinate of its centre and its height (kept within limits), each only when given,
   * so a move never overwrites a resize sent alongside it.
   */
  | {
      kind: 'transform-overlay';
      placementId: string;
      position?: Partial<NormalizedPoint>;
      height?: number;
    }
  /**
   * Moves an Overlay to `toIndex` among the Overlays (0 is the back; past the front stays in
   * front), so it stands in front of the ones below it. Overlays stay above every Background.
   */
  | { kind: 'move-overlay'; placementId: string; toIndex: number }
  /** Renames the Scene (its private name; never shown to players). */
  | { kind: 'rename'; name: string }
  /**
   * Sets the player-facing Scene title, shown discreetly on the broadcast; '' clears it.
   */
  | { kind: 'set-title'; title: string }
  /**
   * Sets the text of an Overlay's Label. A new Label starts Hidden; empty text removes the
   * Label.
   */
  | { kind: 'set-label-text'; overlayId: string; text: string }
  /** Shows or hides an Overlay's Label, independently of the Overlay. */
  | { kind: 'set-label-visible'; overlayId: string; visible: boolean }
  /**
   * Adds a Music Media at the end of the Scene's Music list. A Media is listed once: adding one
   * already listed is refused.
   */
  | { kind: 'add-music'; mediaId: MediaId }
  /**
   * Adds an Ambience Media at the end of the Scene's Ambiences, switched off at full volume, so
   * adding one never makes a sound. A Media is listed once: adding one already listed is refused.
   */
  | { kind: 'add-ambience'; mediaId: MediaId }
  /** Removes an Ambience from the Scene. */
  | { kind: 'remove-ambience'; mediaId: MediaId }
  /** Switches an Ambience on or off; on the Active Scene it fades in or out. */
  | { kind: 'set-ambience-on'; mediaId: MediaId; on: boolean }
  /** Sets an Ambience's own volume (0..1). */
  | { kind: 'set-ambience-volume'; mediaId: MediaId; volume: number }
  /** Sets the Scene's Ambience level (0..1), which applies to all its Ambiences. */
  | { kind: 'set-ambience-level'; level: number };

/**
 * A move or resize of an Overlay in progress (a live drag): shown on air on the Active Scene,
 * never saved. The drag's end is sent as the same edit through `scenes:edit`.
 */
export type OverlayTransform = Extract<SceneEdit, { kind: 'transform-overlay' }>;

/** A Background's zoom or focal point being chosen with a slider: shown and sent like a drag. */
export type BackgroundFraming = Extract<SceneEdit, { kind: 'frame-background' }>;

/**
 * A transient update of a live drag (an Overlay moved or resized, a framing slider dragged):
 * shown on air on the Active Scene, never saved.
 */
export type TransientEdit = OverlayTransform | BackgroundFraming;

/**
 * What can be undone and redone on a Scene: the French label of the next undo and of the next
 * redo ("masquer Orc"), or null when there is none.
 */
export interface UndoState {
  undo: string | null;
  redo: string | null;
}

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
   * Show a transient update of a live drag: on the Active Scene, the broadcast shows the Scene
   * with `edit` applied, without saving it (nor adding an undo step); on any other Scene it does
   * nothing. The window sends at most one per animation frame, then commits the drag's end
   * with `scenes:edit`.
   */
  'scenes:show-transient': {
    payload: { campaignId: CampaignId; sceneId: SceneId; edit: TransientEdit };
    result: void;
  };
  /** What can be undone and redone on a Scene (its undo history, kept by the main process). */
  'scenes:undo-state': { payload: { campaignId: CampaignId; sceneId: SceneId }; result: UndoState };
  /**
   * Undo the last Scene edit of a Scene's history and get the Scene as saved; on the Active
   * Scene it goes on air at once, like any edit. Fails when there is nothing to undo.
   */
  'scenes:undo': { payload: { campaignId: CampaignId; sceneId: SceneId }; result: Scene };
  /** Redo the last undone edit of a Scene, like `scenes:undo`. */
  'scenes:redo': { payload: { campaignId: CampaignId; sceneId: SceneId }; result: Scene };
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
  /**
   * Import files the Game Master dropped from outside the app (Windows Explorer) into the
   * Campaign's library, like `media:import`: images, or audio with the role chosen for the drop.
   * `files` are the dropped files' absolute paths, which only the Control window's bridge reads
   * off the drop.
   */
  'media:import-dropped': {
    payload: { campaignId: CampaignId; files: string[] } & MediaImportKind;
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
   * The global Settings: home page theme, window bounds, each Campaign's last Active Scene
   * (for highlighting only: nothing goes on air after a restart) and the fade duration.
   */
  'settings:get': { payload: void; result: Settings };
  /** Change the theme of the Campaign list home page. */
  'settings:set-theme': { payload: { theme: ThemeId }; result: Settings };
  /**
   * Change the fade duration (milliseconds, bounds in core/fades.ts); every renderer gets it
   * through the on-air state.
   */
  'settings:set-fade-duration': { payload: { fadeDurationMs: number }; result: Settings };
  /** Change the Master volume (0..1): kept across restarts, ramped on all app audio. */
  'settings:set-master-volume': { payload: { masterVolume: number }; result: Settings };
  /** The current mix, for the audio engine (on start and on every reload). */
  'audio:get-mix': { payload: void; result: AudioMix };
  /** The audio engine reports what is actually sounding. */
  'audio:report': { payload: AudioEngineReport; result: void };
  /** What is sounding, for the "En cours" strip. */
  'audio:get-sounding': { payload: void; result: AudioSounding };
}

/** Main-to-window notifications (`webContents.send`), by payload type. */
export interface EventChannels {
  /** Every new on-air snapshot; a window ignores one older than what it shows. */
  'onAir:changed': OnAirState;
  /** Every new mix, for the audio engine; it ignores one older than what it applies. */
  'audio:mix-changed': AudioMix;
  /** What is sounding changed (a new mix, or an engine report), for the "En cours" strip. */
  'audio:sounding-changed': AudioSounding;
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

/**
 * Read-only bridge of the Broadcast window: read and subscribe, nothing else. It gets no audio
 * data: audio plays in the Control window (ADR-0002).
 */
export interface BroadcastBridge {
  getOnAir(): Promise<OnAirState>;
  onOnAirChanged(listener: (snapshot: OnAirState) => void): Unsubscribe;
}

/**
 * Bridge of the audio engine, which runs in the Control window (ADR-0002), exposed apart from
 * the Control bridge (`window.regieAudio`): it can only receive the mix and report what sounds,
 * never change Scenes or the on-air state.
 */
export interface AudioEngineBridge {
  getMix(): Promise<AudioMix>;
  onMixChanged(listener: (mix: AudioMix) => void): Unsubscribe;
  report(report: AudioEngineReport): Promise<void>;
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
  showTransientEdit(campaignId: CampaignId, sceneId: SceneId, edit: TransientEdit): Promise<void>;
  getUndoState(campaignId: CampaignId, sceneId: SceneId): Promise<UndoState>;
  undoSceneEdit(campaignId: CampaignId, sceneId: SceneId): Promise<Scene>;
  redoSceneEdit(campaignId: CampaignId, sceneId: SceneId): Promise<Scene>;
  deleteScene(campaignId: CampaignId, sceneId: SceneId): Promise<void>;
  openBroadcast(): Promise<void>;
  toggleBroadcastFullscreen(): Promise<boolean>;
  listMedia(campaignId: CampaignId): Promise<Media[]>;
  importMedia(campaignId: CampaignId, kind: MediaImportKind): Promise<MediaImportResult>;
  /**
   * Imports files dropped from outside the app, as `kind`. Takes the drop's File objects, not
   * paths: the bridge reads their paths itself, so the page cannot name other files.
   */
  importDroppedMedia(
    campaignId: CampaignId,
    files: readonly File[],
    kind: MediaImportKind,
  ): Promise<MediaImportResult>;
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
  setFadeDuration(fadeDurationMs: number): Promise<Settings>;
  setMasterVolume(masterVolume: number): Promise<Settings>;
  getSounding(): Promise<AudioSounding>;
  onSoundingChanged(listener: (sounding: AudioSounding) => void): Unsubscribe;
}
