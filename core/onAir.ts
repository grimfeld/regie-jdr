/**
 * The on-air state: what the Broadcast window shows. Owned by the main process, kept in memory
 * only (after a restart nothing is on air). No Node or Electron dependency: the interface
 * imports `latestOnAir` from here.
 *
 * Every change increases `version`, so a window can tell a stale snapshot from a newer one
 * (see `latestOnAir`). The commands that check Campaigns and Scenes exist, and save edits,
 * are in core/onAirCommands.ts.
 */
import type {
  CampaignId,
  Media,
  OnAirBackground,
  OnAirOverlay,
  OnAirScene,
  OnAirState,
  Scene,
  SceneId,
  Transition,
  TransitionKind,
} from '../shared/domain.js';
import type { ActivateOptions } from '../shared/contract.js';
import { ACTIVATE_DURATION_MS, FADE_DURATION_MS } from './fades.js';
import { mediaAddress } from './mediaAddress.js';

export interface OnAir {
  /** The current snapshot. */
  current(): OnAirState;
  /** Opens (or switches to) a Campaign: nothing of it is on air until a Scene is Activated. */
  openCampaign(campaignId: CampaignId): OnAirState;
  /** Closes the open Campaign: nothing is on air. */
  closeCampaign(): OnAirState;
  /**
   * Puts a Scene of the open Campaign on air, starting a new Transition of `kind` to it from
   * whatever is on air: black when nothing is, the picture of a Transition still in progress
   * (there is no queue). A Crossfade dissolves over the Activate duration; a Cut takes no time.
   * Blackout stays as it is: the Transition runs underneath. Throws when no Campaign is open.
   */
  activateScene(sceneId: SceneId, scene: OnAirScene, kind?: TransitionKind): OnAirState;
  /**
   * Shows the new picture of the Active Scene after an edit. Returns undefined, changing
   * nothing, when `sceneId` is not the Active Scene.
   */
  showActiveScene(sceneId: SceneId, scene: OnAirScene): OnAirState | undefined;
  /**
   * Takes a deleted Scene off air: when `sceneId` is the Active Scene, nothing is on air any
   * more (the Campaign stays open, Blackout as it is). Returns undefined, changing nothing,
   * when it is not the Active Scene.
   */
  clearActiveScene(sceneId: SceneId): OnAirState | undefined;
  /**
   * Starts or ends Blackout: the broadcast fades to black, the Active Scene stays as it is.
   * Activating a Scene leaves it as it is; opening, switching or closing a Campaign clears it.
   */
  setBlackout(on: boolean): OnAirState;
  /**
   * Sets the fade duration every renderer uses (the Settings value, already checked). The same
   * duration changes nothing, so reading it from Settings at start-up starts no new version.
   */
  setFadeDuration(fadeDurationMs: number): OnAirState;
  /**
   * Sets the Activate duration a Crossfade takes (the Settings value, already checked), from
   * the next Activate on: a Transition carries its own duration, so nothing on air changes.
   */
  setActivateDuration(activateDurationMs: number): void;
  /** Calls `listener` with each new snapshot. Returns the unsubscribe function. */
  subscribe(listener: (snapshot: OnAirState) => void): () => void;
}

/** A deep copy: snapshots handed out cannot be used to change the state. */
function copy(state: OnAirState): OnAirState {
  return structuredClone(state);
}

/** What the on-air state depends on: the clock Transitions are timed by (Date.now). */
export interface OnAirOptions {
  now?: () => number;
}

export function createOnAir({ now = Date.now }: OnAirOptions = {}): OnAir {
  // Never reset, so a renderer never mistakes a new Transition for one it already ran.
  let transitions = 0;
  let activateDurationMs: number = ACTIVATE_DURATION_MS.default;
  let state: OnAirState = {
    campaignId: null,
    activeSceneId: null,
    scene: null,
    blackout: false,
    fadeDurationMs: FADE_DURATION_MS.default,
    transition: null,
    version: 0,
  };
  const listeners = new Set<(snapshot: OnAirState) => void>();

  function change(next: Omit<OnAirState, 'version'>): OnAirState {
    state = copy({ ...next, version: state.version + 1 });
    for (const listener of listeners) listener(copy(state));
    return copy(state);
  }

  return {
    current: () => copy(state),
    openCampaign: (campaignId) =>
      change({
        ...state,
        campaignId,
        activeSceneId: null,
        scene: null,
        blackout: false,
        transition: null,
      }),
    closeCampaign: () =>
      change({
        ...state,
        campaignId: null,
        activeSceneId: null,
        scene: null,
        blackout: false,
        transition: null,
      }),
    activateScene: (sceneId, scene, kind = 'crossfade') => {
      const { campaignId } = state;
      if (campaignId === null) throw new Error('Cannot Activate a Scene: no Campaign is open');
      transitions += 1;
      const transition: Transition = {
        id: transitions,
        kind,
        from: state.activeSceneId,
        to: sceneId,
        startedAt: now(),
        durationMs: kind === 'cut' ? 0 : activateDurationMs,
      };
      return change({ ...state, campaignId, activeSceneId: sceneId, scene, transition });
    },
    showActiveScene: (sceneId, scene) => {
      if (state.activeSceneId === null || state.activeSceneId !== sceneId) return undefined;
      return change({ ...state, scene });
    },
    clearActiveScene: (sceneId) => {
      if (state.activeSceneId === null || state.activeSceneId !== sceneId) return undefined;
      return change({ ...state, activeSceneId: null, scene: null });
    },
    setBlackout: (on) => change({ ...state, blackout: on }),
    setFadeDuration: (fadeDurationMs) =>
      fadeDurationMs === state.fadeDurationMs ? copy(state) : change({ ...state, fadeDurationMs }),
    setActivateDuration: (durationMs) => {
      activateDurationMs = durationMs;
    },
    subscribe: (listener) => {
      const own = (snapshot: OnAirState) => listener(snapshot);
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
}

/**
 * The Transition Activating `scene` starts: a Cut when `forceCut` (Shift held on Activate),
 * otherwise the Scene's own entry Transition. The Scene itself is never changed.
 */
export function transitionOnActivate(
  scene: Pick<Scene, 'transition'>,
  { forceCut = false }: ActivateOptions = {},
): TransitionKind {
  return forceCut ? 'cut' : scene.transition;
}

/**
 * The broadcast projection of a Scene: what players see of it, and nothing else (see
 * OnAirScene). Visible Backgrounds and Overlays whose Media is an image in `library`, bottom
 * to top, with their Media addresses; an Overlay's Label text only when the Label is shown;
 * the Scene title only when set. Never the Scene's name, its notes or Media names.
 */
export function onAirSceneOf(scene: Scene, library: readonly Media[]): OnAirScene {
  const addressOf = (mediaId: string) => {
    const media = library.find((item) => item.id === mediaId && item.kind === 'image');
    return media && mediaAddress(media);
  };
  const backgrounds: OnAirScene['backgrounds'] = [];
  for (const { id, mediaId, fit, zoom, focus, visible } of scene.backgrounds) {
    const src = visible ? addressOf(mediaId) : undefined;
    if (src) backgrounds.push({ id, src, fit, zoom, focus: { ...focus } });
  }
  const overlays: OnAirScene['overlays'] = [];
  for (const { id, mediaId, position, height, visible, label } of scene.overlays) {
    const src = visible ? addressOf(mediaId) : undefined;
    if (!src) continue;
    const shownLabel = label?.visible && label.text.trim() ? label.text : undefined;
    overlays.push({
      id,
      src,
      position: { ...position },
      height,
      ...(shownLabel !== undefined && { label: shownLabel }),
    });
  }
  const title = scene.title.trim();
  return { backgrounds, overlays, ...(title && { title }) };
}

/** The full Selected Scene as the editor draws it (src/SceneCanvas.tsx `Picture`). */
export interface EditorPicture {
  backgrounds: (OnAirBackground & { hidden: boolean })[];
  overlays: (OnAirOverlay & { hidden: boolean; labelHidden?: boolean })[];
  title?: string;
}

/**
 * What the editor draws of the Selected Scene: every placement whose Media is an image in
 * `library`, Hidden ones included and marked `hidden`, so the Game Master sees them in the
 * GM-only style; Labels with text, marked `labelHidden` when Hidden; the Scene title when set.
 * Only for the Control window: the Broadcast window gets `onAirSceneOf`.
 */
export function editorPictureOf(scene: Scene, library: readonly Media[]): EditorPicture {
  const addressOf = (mediaId: string) => {
    const media = library.find((item) => item.id === mediaId && item.kind === 'image');
    return media && mediaAddress(media);
  };
  const backgrounds: EditorPicture['backgrounds'] = [];
  for (const { id, mediaId, fit, zoom, focus, visible } of scene.backgrounds) {
    const src = addressOf(mediaId);
    if (src) backgrounds.push({ id, src, fit, zoom, focus: { ...focus }, hidden: !visible });
  }
  const overlays: EditorPicture['overlays'] = [];
  for (const { id, mediaId, position, height, visible, label } of scene.overlays) {
    const src = addressOf(mediaId);
    if (!src) continue;
    const labelled = label?.text.trim() ? label : undefined;
    overlays.push({
      id,
      src,
      position: { ...position },
      height,
      hidden: !visible,
      ...(labelled && { label: labelled.text, labelHidden: !labelled.visible }),
    });
  }
  const title = scene.title.trim();
  return { backgrounds, overlays, ...(title && { title }) };
}

/**
 * What a window should show after receiving `incoming`, given it shows `shown` (null before
 * the first snapshot): a snapshot is only taken if its version is newer, so a late reply or a
 * stale event never replaces a newer state.
 */
export function latestOnAir(shown: OnAirState | null, incoming: OnAirState): OnAirState {
  return shown === null || incoming.version > shown.version ? incoming : shown;
}
