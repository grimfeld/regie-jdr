/**
 * The on-air commands the Control window gives: open or close a Campaign, Activate a Scene,
 * start or end Blackout, edit a Scene, delete Media (which can change Scenes, so the Active Scene's picture). They
 * check that Campaigns, Scenes and Media exist, save Scene edits, and keep the on-air state
 * (core/onAir.ts) in step. No Electron dependency.
 *
 * Commands run one at a time, in the order they arrive, so a slow save never lets an older
 * picture overtake a newer one.
 */
import type { MediaDeletion } from '../shared/contract.js';
import { randomUUID } from 'node:crypto';
import type { CampaignId, MediaId, OnAirState, Scene, SceneId } from '../shared/domain.js';
import { CampaignError } from './campaigns.js';
import { MediaError, type MediaLibrary } from './media.js';
import { onAirSceneOf, type OnAir } from './onAir.js';
import { applySceneEdit, placedMedia, type SceneEdit } from './sceneEdits.js';
import { SceneError, sceneUsesMedia, type SceneLibrary } from './scenes.js';
import { createSerialQueue } from './serialQueue.js';
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
}): OnAirCommands {
  const { campaigns, library, scenes, onAir, audio, newId = randomUUID } = deps;

  const serialized = createSerialQueue();

  async function picture(scene: Scene) {
    return onAirSceneOf(scene, await library.list(scene.campaignId));
  }

  return {
    openCampaign: (campaignId) =>
      serialized(async () => {
        if (!(await campaigns.get(campaignId))) {
          throw new CampaignError('Cette campagne n’existe plus.');
        }
        audio.halt();
        return onAir.openCampaign(campaignId);
      }),

    closeCampaign: () =>
      serialized(() => {
        audio.halt();
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
        const mediaId = placedMedia(edit);
        if (mediaId !== undefined) {
          const media = (await library.list(campaignId)).find((item) => item.id === mediaId);
          if (media?.kind !== 'image') throw new MediaError('Ce média n’existe plus.');
        }
        const saved = await scenes.save(applySceneEdit(scene, edit, newId));
        const current = onAir.current();
        if (saved.campaignId === current.campaignId && saved.id === current.activeSceneId) {
          onAir.showActiveScene(saved.id, await picture(saved));
        }
        return saved;
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
