/**
 * The on-air commands the Control window gives: open or close a Campaign, Activate a Scene,
 * start or end Blackout, edit a Scene and undo or redo its edits, delete Media (which can change Scenes, so the Active Scene's picture). They
 * check that Campaigns, Scenes and Media exist, save Scene edits, and keep the on-air state
 * (core/onAir.ts) in step. No Electron dependency.
 *
 * Commands run one at a time, in the order they arrive, so a slow save never lets an older
 * picture overtake a newer one.
 */
import type { MediaDeletion, OverlayTransform, UndoState } from '../shared/contract.js';
import { randomUUID } from 'node:crypto';
import type { CampaignId, MediaId, OnAirState, Scene, SceneId } from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { MediaError, type MediaLibrary } from './media.js';
import { onAirSceneOf, type OnAir } from './onAir.js';
import { applySceneEdit, placedMedia, type SceneEdit } from './sceneEdits.js';
import { SceneError, sceneUsesMedia, type SceneLibrary } from './scenes.js';
import { createSerialQueue } from './serialQueue.js';
import {
  createUndoHistories,
  isSameValue,
  mergeKeyOf,
  undoLabel,
  type UndoHistories,
  type UndoMove,
} from './undoHistory.js';
import type { CampaignRepository } from './storage/index.js';

/** Where audio plays. No audio engine yet: stopping is announced to the windows. */
export interface AudioOutput {
  halt(): void;
}

export interface OnAirCommands {
  /** Opens (or switches to) a Campaign: stops audio, nothing is on air. */
  openCampaign(campaignId: CampaignId): Promise<OnAirState>;
  /** Back to the Campaign list: stops audio, nothing is on air. */
  closeCampaign(): Promise<OnAirState>;
  /** Puts a Scene of the open Campaign on air, as the Active Scene. */
  activateScene(sceneId: SceneId): Promise<OnAirState>;
  /**
   * Starts or ends Blackout in the open Campaign: the broadcast fades to black, the Active
   * Scene and its edits stay as they are. Never saved: opening, switching or closing a
   * Campaign, and a restart, clear it.
   */
  setBlackout(on: boolean): Promise<OnAirState>;
  /**
   * Applies one edit command to a Scene of a Campaign and saves it; returns the Scene as saved.
   * When it is the Active Scene, the Broadcast window shows the edit at once; any other Scene
   * stays private. Every Scene composition edit goes through here, one at a time: this is
   * where the Scene before and after each edit is known, for an undo history.
   */
  editScene(campaignId: CampaignId, sceneId: SceneId, edit: SceneEdit): Promise<Scene>;
  /**
   * Shows a transient update of a live drag (a move or resize of an Overlay): on the Active
   * Scene, the broadcast shows the saved Scene with `edit` applied; nothing is saved and no
   * undo step is recorded. On any other Scene it does nothing. The drag ends with the same
   * edit through `editScene`, which saves it as one step.
   */
  showTransientEdit(
    campaignId: CampaignId,
    sceneId: SceneId,
    edit: OverlayTransform,
  ): Promise<void>;
  /** What can be undone and redone on a Scene: the labels of its next undo and redo. */
  undoState(campaignId: CampaignId, sceneId: SceneId): Promise<UndoState>;
  /**
   * Undoes the last edit in a Scene's undo history: saves the Scene as it was before it and
   * returns it. On the Active Scene the broadcast shows it at once, like any edit.
   */
  undoSceneEdit(campaignId: CampaignId, sceneId: SceneId): Promise<Scene>;
  /** Redoes the last undone edit of a Scene, like `undoSceneEdit`. */
  redoSceneEdit(campaignId: CampaignId, sceneId: SceneId): Promise<Scene>;
  /**
   * Deletes a Scene of a Campaign. When it is the Active Scene, the Active Scene is cleared and
   * the Broadcast window shows nothing on air.
   */
  deleteScene(campaignId: CampaignId, sceneId: SceneId): Promise<void>;
  /**
   * Deletes a Media. Unused Media goes at once. Media that Scenes use is only listed with
   * those Scenes unless `confirmed`; then the Media, its file and its placements in those
   * Scenes are removed, and the broadcast drops it if the Active Scene showed it.
   */
  deleteMedia(campaignId: CampaignId, mediaId: MediaId, confirmed: boolean): Promise<MediaDeletion>;
}

export function createOnAirCommands(deps: {
  campaigns: CampaignRepository;
  library: MediaLibrary;
  scenes: SceneLibrary;
  onAir: OnAir;
  audio: AudioOutput;
  /** Names new placements; random UUIDs unless a test gives its own. */
  newId?: () => string;
  /** The Scenes' undo histories; fresh ones unless a test gives its own (with its clock). */
  histories?: UndoHistories;
}): OnAirCommands {
  const { campaigns, library, scenes, onAir, audio, newId = randomUUID } = deps;
  const histories = deps.histories ?? createUndoHistories();

  const serialized = createSerialQueue();

  async function picture(scene: Scene) {
    return onAirSceneOf(scene, await library.list(scene.campaignId));
  }

  /** Saves a Scene and, when it is the Active Scene, puts it on air. */
  async function saveScene(scene: Scene) {
    const saved = await scenes.save(scene);
    const current = onAir.current();
    if (saved.campaignId === current.campaignId && saved.id === current.activeSceneId) {
      onAir.showActiveScene(saved.id, await picture(saved));
    }
    return saved;
  }

  /**
   * Undoes or redoes (`move`) on a Scene, applied literally: the Scene saved before the step
   * comes back. A Scene changed outside its history since (its placements of a deleted Media)
   * cannot be: its history is cleared.
   */
  async function travel(
    campaignId: CampaignId,
    sceneId: SceneId,
    move: UndoMove | undefined,
    nothing: string,
  ) {
    if (!move) throw new SceneError(nothing);
    const scene = await scenes.get(campaignId, sceneId);
    if (!scene) throw new SceneError('Cette scène n’existe plus.');
    if (!isSameValue(scene, move.expected)) {
      histories.clear(campaignId, sceneId);
      throw new SceneError('La scène a changé entre-temps : son historique est effacé.');
    }
    return saveScene(move.restore);
  }

  return {
    openCampaign: (campaignId) =>
      serialized(async () => {
        if (!(await campaigns.get(campaignId))) {
          throw new CampaignError('Cette campagne n’existe plus.');
        }
        audio.halt();
        histories.clearAll();
        return onAir.openCampaign(campaignId);
      }),

    closeCampaign: () =>
      serialized(() => {
        audio.halt();
        histories.clearAll();
        return onAir.closeCampaign();
      }),

    activateScene: (sceneId) =>
      serialized(async () => {
        const { campaignId } = onAir.current();
        if (campaignId === null) {
          throw new SceneError('Ouvrez une campagne avant d’activer une scène.');
        }
        const scene = await scenes.get(campaignId, sceneId);
        if (!scene) throw new SceneError('Cette scène n’existe plus.');
        return onAir.activateScene(scene.id, await picture(scene));
      }),

    setBlackout: (on) =>
      serialized(() => {
        if (onAir.current().campaignId === null) {
          throw new CampaignError('Ouvrez une campagne avant de passer au noir.');
        }
        return onAir.setBlackout(on);
      }),

    editScene: (campaignId, sceneId, edit) =>
      serialized(async () => {
        const scene = await scenes.get(campaignId, sceneId);
        if (!scene) throw new SceneError('Cette scène n’existe plus.');
        const media = await library.list(campaignId);
        const mediaId = placedMedia(edit);
        if (mediaId !== undefined) {
          const placing = media.find((item) => item.id === mediaId);
          if (placing?.kind !== 'image') throw new MediaError('Ce média n’existe plus.');
        }
        const saved = await saveScene(applySceneEdit(scene, edit, newId));
        histories.record({
          before: scene,
          after: saved,
          label: undoLabel(scene, edit, (id) => media.find((item) => item.id === id)?.name),
          mergeKey: mergeKeyOf(edit),
        });
        return saved;
      }),

    showTransientEdit: (campaignId, sceneId, edit) =>
      serialized(async () => {
        const current = onAir.current();
        if (current.campaignId !== campaignId || current.activeSceneId !== sceneId) return;
        const scene = await scenes.get(campaignId, sceneId);
        if (!scene) throw new SceneError('Cette scène n’existe plus.');
        onAir.showActiveScene(sceneId, await picture(applySceneEdit(scene, edit, newId)));
      }),

    undoState: (campaignId, sceneId) => serialized(() => histories.state(campaignId, sceneId)),

    undoSceneEdit: (campaignId, sceneId) =>
      serialized(async () => {
        const move = histories.nextUndo(campaignId, sceneId);
        const saved = await travel(campaignId, sceneId, move, 'Rien à annuler.');
        histories.undone(campaignId, sceneId);
        return saved;
      }),

    redoSceneEdit: (campaignId, sceneId) =>
      serialized(async () => {
        const move = histories.nextRedo(campaignId, sceneId);
        const saved = await travel(campaignId, sceneId, move, 'Rien à rétablir.');
        histories.redone(campaignId, sceneId);
        return saved;
      }),

    deleteScene: (campaignId, sceneId) =>
      serialized(async () => {
        await scenes.delete(campaignId, sceneId);
        histories.clear(campaignId, sceneId);
        if (onAir.current().campaignId === campaignId) onAir.clearActiveScene(sceneId);
      }),

    deleteMedia: (campaignId, mediaId, confirmed) =>
      serialized(async () => {
        if (!(await library.list(campaignId)).some((media) => media.id === mediaId)) {
          throw new MediaError('Ce média n’existe plus.');
        }
        const summary = ({ id, name }: Scene) => ({ id, name });
        const using = (await scenes.list(campaignId)).filter((scene) =>
          sceneUsesMedia(scene, mediaId),
        );
        if (using.length > 0 && !confirmed) {
          return { deleted: false, affectedScenes: using.map(summary) };
        }
        // Placements first: if the Media delete then fails, no Scene points at a missing Media.
        const cleaned = await scenes.removeMediaPlacements(campaignId, mediaId);
        // Their histories could bring the deleted Media back: forget them.
        cleaned.forEach((scene) => histories.clear(campaignId, scene.id));
        await library.delete(campaignId, mediaId);
        const current = onAir.current();
        const active = cleaned.find((scene) => scene.id === current.activeSceneId);
        if (active && current.campaignId === campaignId) {
          onAir.showActiveScene(active.id, await picture(active));
        }
        return { deleted: true, affectedScenes: cleaned.map(summary) };
      }),
  };
}
