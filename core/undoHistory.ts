/**
 * Undo and redo of Scene edits (spec #21, "Scene editing commands and undo"). The app core keeps
 * one history per Scene, in memory only: `editScene` (core/onAirCommands.ts) records the Scene
 * before and after each edit, and undo or redo saves one of them back. Nothing else enters a
 * history: creating or deleting a Scene, Activate, Blackout and Media operations are not
 * undoable. Opening, switching or closing a Campaign clears every history; so does a restart.
 *
 * Each step carries a short French label for the undo and redo buttons ("masquer Orc").
 */
import type { SceneEdit, UndoState } from '../shared/contract.js';
import type { CampaignId, MediaId, Scene, SceneId } from '../shared/domain.js';

export type { UndoState };

/** How many steps a Scene's history keeps; older ones are forgotten. */
export const UNDO_DEPTH = 100;

/**
 * Edits with the same merge key that follow each other within this time are one step: a burst
 * of arrow-key nudges whose edits the editor had to send apart still undoes at once.
 */
export const MERGE_WINDOW_MS = 1000;

/** One edit as `editScene` saw it. */
export interface RecordedEdit {
  /** The Scene as saved before the edit. */
  before: Scene;
  /** The Scene as saved after it. */
  after: Scene;
  /** What the undo button says it undoes, in French: "masquer Orc". */
  label: string;
  /** Edits sharing a merge key may merge into one step (see `mergeKeyOf`). */
  mergeKey?: string;
}

/**
 * What undo or redo would do: the Scene must still be saved as `expected` (otherwise something
 * outside the history changed it), and `restore` is then saved in its place.
 */
export interface UndoMove {
  expected: Scene;
  restore: Scene;
}

interface Step {
  before: Scene;
  after: Scene;
  label: string;
  mergeKey?: string;
  /** When the step was last recorded or merged into (ms). */
  at: number;
}

interface History {
  undo: Step[];
  redo: Step[];
  /** Whether the last thing done was recording `undo`'s top step, so a new edit may merge. */
  mergeOpen: boolean;
}

export interface UndoHistories {
  /** Records an edit on its Scene's history; an edit that changed nothing is not recorded. */
  record(edit: RecordedEdit): void;
  /** The labels of the next undo and redo of a Scene. */
  state(campaignId: CampaignId, sceneId: SceneId): UndoState;
  /** What undoing the last step of a Scene would do, if there is one. */
  nextUndo(campaignId: CampaignId, sceneId: SceneId): UndoMove | undefined;
  /** Moves the last step to the redo side, once its `restore` is saved. */
  undone(campaignId: CampaignId, sceneId: SceneId): void;
  /** What redoing the last undone step of a Scene would do, if there is one. */
  nextRedo(campaignId: CampaignId, sceneId: SceneId): UndoMove | undefined;
  /** Moves the last undone step back to the undo side, once its `restore` is saved. */
  redone(campaignId: CampaignId, sceneId: SceneId): void;
  /** Forgets a Scene's history (deleted Scene, or changed outside the history). */
  clear(campaignId: CampaignId, sceneId: SceneId): void;
  /** Forgets every history (Campaign opened, switched or closed). */
  clearAll(): void;
}

export function createUndoHistories(
  options: { depth?: number; mergeWindowMs?: number; now?: () => number } = {},
): UndoHistories {
  const { depth = UNDO_DEPTH, mergeWindowMs = MERGE_WINDOW_MS, now = Date.now } = options;
  const histories = new Map<string, History>();
  const keyOf = (campaignId: CampaignId, sceneId: SceneId) => JSON.stringify([campaignId, sceneId]);

  function historyOf(campaignId: CampaignId, sceneId: SceneId): History {
    const key = keyOf(campaignId, sceneId);
    let history = histories.get(key);
    if (!history) {
      history = { undo: [], redo: [], mergeOpen: false };
      histories.set(key, history);
    }
    return history;
  }

  function peek(campaignId: CampaignId, sceneId: SceneId) {
    return histories.get(keyOf(campaignId, sceneId)) ?? { undo: [], redo: [], mergeOpen: false };
  }

  return {
    record({ before, after, label, mergeKey }) {
      if (isSameValue(before, after)) return;
      const history = historyOf(after.campaignId, after.id);
      const time = now();
      const last = history.undo.at(-1);
      history.redo = [];
      if (
        last &&
        history.mergeOpen &&
        mergeKey !== undefined &&
        last.mergeKey === mergeKey &&
        time - last.at <= mergeWindowMs
      ) {
        history.undo[history.undo.length - 1] = { ...last, after, label, at: time };
      } else {
        history.undo.push({ before, after, label, mergeKey, at: time });
        if (history.undo.length > depth) history.undo.splice(0, history.undo.length - depth);
      }
      history.mergeOpen = true;
    },

    state(campaignId, sceneId) {
      const { undo, redo } = peek(campaignId, sceneId);
      return { undo: undo.at(-1)?.label ?? null, redo: redo.at(-1)?.label ?? null };
    },

    nextUndo(campaignId, sceneId) {
      const step = peek(campaignId, sceneId).undo.at(-1);
      return step && { expected: step.after, restore: step.before };
    },

    undone(campaignId, sceneId) {
      const history = historyOf(campaignId, sceneId);
      const step = history.undo.pop();
      if (step) history.redo.push(step);
      history.mergeOpen = false;
    },

    nextRedo(campaignId, sceneId) {
      const step = peek(campaignId, sceneId).redo.at(-1);
      return step && { expected: step.before, restore: step.after };
    },

    redone(campaignId, sceneId) {
      const history = historyOf(campaignId, sceneId);
      const step = history.redo.pop();
      if (step) history.undo.push(step);
      history.mergeOpen = false;
    },

    clear(campaignId, sceneId) {
      histories.delete(keyOf(campaignId, sceneId));
    },

    clearAll() {
      histories.clear();
    },
  };
}

/**
 * Edits that may merge into one step when they follow each other quickly: moves and resizes of
 * the same Overlay (a nudge burst). Any other edit is a step of its own.
 */
export function mergeKeyOf(edit: SceneEdit): string | undefined {
  return edit.kind === 'transform-overlay' ? `transform-overlay:${edit.placementId}` : undefined;
}

/**
 * The French label of an edit for the undo and redo buttons, naming the image it touches by its
 * Media name (`mediaName`); `scene` is the Scene before the edit.
 */
export function undoLabel(
  scene: Scene,
  edit: SceneEdit,
  mediaName: (mediaId: MediaId) => string | undefined,
): string {
  const placed = (placementId: string) => {
    const placement = [...scene.backgrounds, ...scene.overlays].find(
      (item) => item.id === placementId,
    );
    return (placement && mediaName(placement.mediaId)) ?? 'l’image';
  };
  switch (edit.kind) {
    case 'place-background':
      return `placer ${mediaName(edit.mediaId) ?? 'l’image'} en arrière-plan`;
    case 'place-overlay':
      return `placer ${mediaName(edit.mediaId) ?? 'l’image'} en superposition`;
    case 'set-visible':
      return `${edit.visible ? 'afficher' : 'masquer'} ${placed(edit.placementId)}`;
    case 'remove-placement':
      return `retirer ${placed(edit.placementId)}`;
    case 'move-background':
    case 'move-overlay':
      return `réordonner ${placed(edit.placementId)}`;
    case 'set-background-fit':
      return `régler ${placed(edit.placementId)} sur ${edit.fit === 'cover' ? 'Couvrir' : 'Contenir'}`;
    case 'frame-background':
      return `cadrer ${placed(edit.placementId)}`;
    case 'transform-overlay':
      return `${edit.height === undefined ? 'déplacer' : 'redimensionner'} ${placed(edit.placementId)}`;
    case 'rename':
      return 'renommer la scène';
    case 'set-title':
      return 'modifier le titre affiché';
    case 'set-label-text':
      return edit.text.trim()
        ? `étiqueter ${placed(edit.overlayId)}`
        : `retirer l’étiquette (${placed(edit.overlayId)})`;
    case 'set-label-visible':
      return `${edit.visible ? 'afficher' : 'masquer'} l’étiquette (${placed(edit.overlayId)})`;
    case 'add-music':
      return `ajouter la musique ${mediaName(edit.mediaId) ?? ''}`.trimEnd();
  }
}

/** Whether two JSON values (saved Scenes) are equal, whatever their keys' order. */
export function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => isSameValue(item, b[index]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = new Map(Object.entries(b).filter(([, value]) => value !== undefined));
  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && isSameValue(value, right.get(key)))
  );
}
