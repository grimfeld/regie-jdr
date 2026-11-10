/**
 * The on-air state: what the Broadcast window shows. Owned by the main process, kept in memory
 * only (after a restart nothing is on air). No Electron dependency.
 *
 * Every change increases `version`, so a window can tell a stale snapshot from a newer one
 * (see `latestOnAir`).
 */
import type { CampaignId, OnAirState, SceneId } from '../shared/domain.js';

export interface OnAir {
  /** The current snapshot. */
  current(): OnAirState;
  /** Opens (or switches to) a Campaign: nothing of it is on air until a Scene is Activated. */
  openCampaign(campaignId: CampaignId): OnAirState;
  /** Closes the open Campaign: nothing is on air. */
  closeCampaign(): OnAirState;
  /** Puts a Scene of the open Campaign on air. Throws when no Campaign is open. */
  activateScene(sceneId: SceneId): OnAirState;
  /** Calls `listener` with each new snapshot. Returns the unsubscribe function. */
  subscribe(listener: (snapshot: OnAirState) => void): () => void;
}

export function createOnAir(): OnAir {
  let state: OnAirState = { campaignId: null, activeSceneId: null, version: 0 };
  const listeners = new Set<(snapshot: OnAirState) => void>();

  function change(next: Omit<OnAirState, 'version'>): OnAirState {
    state = { ...next, version: state.version + 1 };
    for (const listener of listeners) listener({ ...state });
    return { ...state };
  }

  return {
    current: () => ({ ...state }),
    openCampaign: (campaignId) => change({ campaignId, activeSceneId: null }),
    closeCampaign: () => change({ campaignId: null, activeSceneId: null }),
    activateScene: (sceneId) => {
      const { campaignId } = state;
      if (campaignId === null) throw new Error('Cannot Activate a Scene: no Campaign is open');
      return change({ campaignId, activeSceneId: sceneId });
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
 * What a window should show after receiving `incoming`, given it shows `shown` (null before
 * the first snapshot): a snapshot is only taken if its version is newer, so a late reply or a
 * stale event never replaces a newer state.
 */
export function latestOnAir(shown: OnAirState | null, incoming: OnAirState): OnAirState {
  return shown === null || incoming.version > shown.version ? incoming : shown;
}
