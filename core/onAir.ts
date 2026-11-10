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
  OnAirScene,
  OnAirState,
  Scene,
  SceneId,
} from '../shared/domain.js';
import { mediaAddress } from './mediaAddress.js';

export interface OnAir {
  /** The current snapshot. */
  current(): OnAirState;
  /** Opens (or switches to) a Campaign: nothing of it is on air until a Scene is Activated. */
  openCampaign(campaignId: CampaignId): OnAirState;
  /** Closes the open Campaign: nothing is on air. */
  closeCampaign(): OnAirState;
  /** Puts a Scene of the open Campaign on air. Throws when no Campaign is open. */
  activateScene(sceneId: SceneId, scene: OnAirScene): OnAirState;
  /**
   * Shows the new picture of the Active Scene after an edit. Returns undefined, changing
   * nothing, when `sceneId` is not the Active Scene.
   */
  showActiveScene(sceneId: SceneId, scene: OnAirScene): OnAirState | undefined;
  /** Calls `listener` with each new snapshot. Returns the unsubscribe function. */
  subscribe(listener: (snapshot: OnAirState) => void): () => void;
}

/** A deep copy: snapshots handed out cannot be used to change the state. */
function copy(state: OnAirState): OnAirState {
  return structuredClone(state);
}

export function createOnAir(): OnAir {
  let state: OnAirState = { campaignId: null, activeSceneId: null, scene: null, version: 0 };
  const listeners = new Set<(snapshot: OnAirState) => void>();

  function change(next: Omit<OnAirState, 'version'>): OnAirState {
    state = copy({ ...next, version: state.version + 1 });
    for (const listener of listeners) listener(copy(state));
    return copy(state);
  }

  return {
    current: () => copy(state),
    openCampaign: (campaignId) => change({ campaignId, activeSceneId: null, scene: null }),
    closeCampaign: () => change({ campaignId: null, activeSceneId: null, scene: null }),
    activateScene: (sceneId, scene) => {
      const { campaignId } = state;
      if (campaignId === null) throw new Error('Cannot Activate a Scene: no Campaign is open');
      return change({ campaignId, activeSceneId: sceneId, scene });
    },
    showActiveScene: (sceneId, scene) => {
      if (state.activeSceneId === null || state.activeSceneId !== sceneId) return undefined;
      return change({ campaignId: state.campaignId, activeSceneId: sceneId, scene });
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
 * What players see of a Scene: its visible Backgrounds and Overlays whose Media is in
 * `library`, in order, with their Media addresses. Nothing private (name, notes, Labels).
 */
export function onAirSceneOf(scene: Scene, library: readonly Media[]): OnAirScene {
  const addressOf = (mediaId: string) => {
    const media = library.find((item) => item.id === mediaId && item.kind === 'image');
    return media && mediaAddress(media);
  };
  const backgrounds: OnAirScene['backgrounds'] = [];
  for (const { id, mediaId, fit, position, visible } of scene.backgrounds) {
    const src = visible ? addressOf(mediaId) : undefined;
    if (src) backgrounds.push({ id, src, fit, position: { ...position } });
  }
  const overlays: OnAirScene['overlays'] = [];
  for (const { id, mediaId, position, scale, zIndex, visible } of scene.overlays) {
    const src = visible ? addressOf(mediaId) : undefined;
    if (src) overlays.push({ id, src, position: { ...position }, scale, zIndex });
  }
  return { backgrounds, overlays };
}

/**
 * What a window should show after receiving `incoming`, given it shows `shown` (null before
 * the first snapshot): a snapshot is only taken if its version is newer, so a late reply or a
 * stale event never replaces a newer state.
 */
export function latestOnAir(shown: OnAirState | null, incoming: OnAirState): OnAirState {
  return shown === null || incoming.version > shown.version ? incoming : shown;
}
