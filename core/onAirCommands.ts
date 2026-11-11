/**
 * The on-air commands the Control window gives: open or close a Campaign, Activate a Scene,
 * start or end Blackout, edit a Scene and undo or redo its edits, delete Media (which can change
 * Scenes, so the Active Scene's picture and sound). They check that Campaigns, Scenes and Media
 * exist, save Scene edits, and keep the on-air state (core/onAir.ts) and its audio part
 * (core/audioOnAir.ts) in step. No Electron dependency.
 *
 * Commands run one at a time, in the order they arrive, so a slow save never lets an older
 * picture overtake a newer one.
 */
import type { MediaDeletion, TransientEdit, UndoState } from '../shared/contract.js';
import { randomUUID } from 'node:crypto';
import type {
  CampaignId,
  Media,
  MediaId,
  MusicPlayback,
  OnAirState,
  Scene,
  SceneId,
} from '../shared/domain.js';
import { audioChangeOf } from './audioMix.js';
import type { AudioOnAir } from './audioOnAir.js';
import { CampaignError } from './campaigns.js';
import { MediaError, type MediaLibrary } from './media.js';
import { mediaAddress } from './mediaAddress.js';
import { onAirSceneOf, type OnAir } from './onAir.js';
import { addedMedia, applySceneEdit, type SceneEdit } from './sceneEdits.js';
import { mediaOfScene, SceneError, sceneUsesMedia, type SceneLibrary } from './scenes.js';
import { createSerialQueue } from './serialQueue.js';
import {
  createUndoHistories,
  isSameValue,
  undoLabel,
  type UndoHistories,
  type UndoMove,
  withNotesOf,
} from './undoHistory.js';
import type { AudioChange } from './fades.js';
import type { SoundboardStore } from './soundboard.js';
import type { CampaignRepository } from './storage/index.js';

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
   * Shows a transient update of a live drag (a move or resize of an Overlay, a framing slider
   * of a Background, a Music or Ambience level or an Ambience volume slider): on the Active Scene, the broadcast shows (or the
   * mix plays) the saved Scene with `edit` applied; nothing is saved and no undo step is
   * recorded. On any other Scene it does nothing. The drag ends with the same edit through
   * `editScene`, which saves it as one step; if that fails, the Scene as saved goes back on air.
   */
  showTransientEdit(campaignId: CampaignId, sceneId: SceneId, edit: TransientEdit): Promise<void>;
  /**
   * Crossfades to a Music of the Active Scene's list. Live playback: the Scene is not saved and
   * no undo step is recorded, so the next Activate starts from its first Music.
   */
  pickMusic(mediaId: MediaId): Promise<void>;
  /** Plays, pauses or stops the Active Scene's current Music; live playback, like `pickMusic`. */
  setMusicPlayback(playback: MusicPlayback): Promise<void>;
  /**
   * Starts (`on`) or lifts Silence, in turn with the other commands: an Activate given just
   * before (which lifts Silence) cannot overtake it. Returns whether Silence started (it was
   * off), for the caller to cut the pads sounding.
   */
  setSilence(on: boolean): Promise<boolean>;
  /**
   * Starts Silence when it is off, lifts it when it is on, from the state the commands before
   * left: pressed twice quickly, it starts then lifts. Returns whether it started.
   */
  toggleSilence(): Promise<boolean>;
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
   * Renames a Media of a Campaign; returns it as saved. A Media sounding on the Active Scene
   * keeps playing as it was, under its new name (the "En cours" strip shows it).
   */
  renameMedia(campaignId: CampaignId, mediaId: MediaId, name: string): Promise<Media>;
  /**
   * Deletes a Media. Unused Media goes at once. Media that Scenes or Soundboard pads use is
   * only listed with those Scenes and pads unless `confirmed`; then the Media, its file, its
   * placements in those Scenes and those pads are removed, and the broadcast drops it if the
   * Active Scene showed it.
   */
  deleteMedia(campaignId: CampaignId, mediaId: MediaId, confirmed: boolean): Promise<MediaDeletion>;
}

export function createOnAirCommands(deps: {
  campaigns: CampaignRepository;
  library: MediaLibrary;
  scenes: SceneLibrary;
  onAir: OnAir;
  /** The audio part of the on-air state: what the audio engine plays. */
  audio: AudioOnAir;
  /** The Campaigns' Soundboards: their pads are uses of a Media too. */
  soundboards: Pick<SoundboardStore, 'get' | 'removeMedia'>;
  /** Names new placements; random UUIDs unless a test gives its own. */
  newId?: () => string;
  /** The Scenes' undo histories; fresh ones unless a test gives its own (with its clock). */
  histories?: UndoHistories;
}): OnAirCommands {
  const { campaigns, library, scenes, onAir, audio, soundboards, newId = randomUUID } = deps;
  const histories = deps.histories ?? createUndoHistories();

  const serialized = createSerialQueue();

  async function picture(scene: Scene) {
    return onAirSceneOf(scene, await library.list(scene.campaignId));
  }

  /**
   * The audio Media of `scene` whose file is missing: its address answers 404, the rule the
   * Media protocol serves by (deleted or moved outside the app). Left out of the mix.
   */
  async function missingAudio(scene: Scene, media: readonly Media[]): Promise<Set<MediaId>> {
    const used = new Set(mediaOfScene(scene));
    const checked = await Promise.all(
      media
        .filter((item) => item.kind === 'audio' && used.has(item.id))
        .map(async (item) => ({
          id: item.id,
          found: await library.resolveAddress(mediaAddress(item), scene.campaignId),
        })),
    );
    return new Set(checked.filter(({ found }) => found === undefined).map(({ id }) => id));
  }

  /** Puts the Active Scene, as it now is, on air: its picture and its sound. */
  async function showActive(scene: Scene, change: AudioChange) {
    const media = await library.list(scene.campaignId);
    const missing = await missingAudio(scene, media);
    onAir.showActiveScene(scene.id, onAirSceneOf(scene, media));
    audio.showActiveScene(scene, media, change, missing);
  }

  /** Saves a Scene and, when it is the Active Scene, puts it on air (`change`: its audio fade). */
  async function saveScene(scene: Scene, change: AudioChange) {
    const saved = await scenes.save(scene);
    const current = onAir.current();
    if (saved.campaignId === current.campaignId && saved.id === current.activeSceneId) {
      await showActive(saved, change);
    }
    return saved;
  }

  /** Throws a MediaError unless the Media an edit adds is in the library and of the right kind. */
  function checkAdded(edit: SceneEdit, media: readonly Media[]) {
    const added = addedMedia(edit);
    if (!added) return;
    const item = media.find((candidate) => candidate.id === added.mediaId);
    if (!item) throw new MediaError('Ce média n’existe plus.');
    switch (added.kind) {
      case 'image':
        if (item.kind !== 'image') throw new MediaError('Seule une image peut être placée.');
        return;
      case 'music':
        if (item.kind !== 'audio' || item.role !== 'music') {
          throw new MediaError('Seule une musique peut aller dans la liste des musiques.');
        }
        return;
      case 'ambience':
        if (item.kind !== 'audio' || item.role !== 'ambience') {
          throw new MediaError('Seule une ambiance peut aller dans la liste des ambiances.');
        }
        return;
    }
  }

  /** Applies one edit to a Scene, saves it and records it in the Scene's undo history. */
  async function applyEdit(campaignId: CampaignId, sceneId: SceneId, edit: SceneEdit) {
    const scene = await scenes.get(campaignId, sceneId);
    if (!scene) throw new SceneError('Cette scène n’existe plus.');
    // Notes: saved only. Never on air, and outside the Scene undo history (their editor has its
    // own undo and redo).
    if (edit.kind === 'set-notes') return scenes.save(applySceneEdit(scene, edit, newId));
    const media = await library.list(campaignId);
    checkAdded(edit, media);
    const saved = await saveScene(applySceneEdit(scene, edit, newId), audioChangeOf(edit));
    histories.record({
      before: scene,
      after: saved,
      label: undoLabel(scene, edit, (id) => media.find((item) => item.id === id)?.name),
    });
    return saved;
  }

  /**
   * Puts the Active Scene back on air as saved, picture and sound, when it is `sceneId` of
   * `campaignId`: a live drag may have shown, or made heard, an update that was never saved.
   */
  async function showSavedActiveScene(campaignId: CampaignId, sceneId: SceneId) {
    const current = onAir.current();
    if (current.campaignId !== campaignId || current.activeSceneId !== sceneId) return;
    const saved = await scenes.get(campaignId, sceneId);
    if (saved) await showActive(saved, 'volume');
  }

  /** Starts (`on`) or lifts Silence; returns whether it started. */
  function silence(on: boolean) {
    const started = on && !audio.silence();
    audio.setSilence(on);
    return started;
  }

  /**
   * Undoes or redoes (`move`) on a Scene, applied literally: the Scene saved before the step
   * comes back. A Scene changed outside its history since (its placements of a deleted Media)
   * cannot be, nor can a step that would bring back a deleted Media (removed from the Scene
   * before it was deleted): its history is cleared.
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
    // Notes are outside the history: compared and kept as they are now.
    if (!isSameValue(scene, withNotesOf(move.expected, scene))) {
      histories.clear(campaignId, sceneId);
      throw new SceneError('La scène a changé entre-temps : son historique est effacé.');
    }
    const known = new Set((await library.list(campaignId)).map((media) => media.id));
    if (!mediaOfScene(move.restore).every((mediaId) => known.has(mediaId))) {
      histories.clear(campaignId, sceneId);
      throw new SceneError(
        'Un média de cette étape a été supprimé de la bibliothèque : l’historique de la scène est effacé.',
      );
    }
    return saveScene(withNotesOf(move.restore, scene), 'undo');
  }

  return {
    openCampaign: (campaignId) =>
      serialized(async () => {
        if (!(await campaigns.get(campaignId))) {
          throw new CampaignError('Cette campagne n’existe plus.');
        }
        audio.clear();
        histories.clearAll();
        return onAir.openCampaign(campaignId);
      }),

    closeCampaign: () =>
      serialized(() => {
        audio.clear();
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
        const media = await library.list(campaignId);
        audio.activateScene(scene, media, await missingAudio(scene, media));
        return onAir.activateScene(scene.id, onAirSceneOf(scene, media));
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
        try {
          return await applyEdit(campaignId, sceneId, edit);
        } catch (error) {
          // A live drag (Overlay, Background framing, Music level) may have shown unsaved transient
          // updates on air: show the Scene as saved again. What the Game Master is told is the
          // edit's own failure, so a failure here is dropped.
          await showSavedActiveScene(campaignId, sceneId).catch(() => undefined);
          throw error;
        }
      }),

    showTransientEdit: (campaignId, sceneId, edit) =>
      serialized(async () => {
        const current = onAir.current();
        if (current.campaignId !== campaignId || current.activeSceneId !== sceneId) return;
        const scene = await scenes.get(campaignId, sceneId);
        if (!scene) throw new SceneError('Cette scène n’existe plus.');
        const shown = applySceneEdit(scene, edit, newId);
        switch (edit.kind) {
          case 'transform-overlay':
          case 'frame-background':
            onAir.showActiveScene(sceneId, await picture(shown));
            return;
          case 'set-music-level':
          case 'set-ambience-level':
          case 'set-ambience-volume': {
            const media = await library.list(campaignId);
            audio.showActiveScene(shown, media, 'volume', await missingAudio(shown, media));
            return;
          }
        }
      }),

    pickMusic: (mediaId) =>
      serialized(() => {
        audio.pickMusic(mediaId);
      }),

    setMusicPlayback: (playback) =>
      serialized(() => {
        audio.setMusicPlayback(playback);
      }),

    setSilence: (on) => serialized(() => silence(on)),

    toggleSilence: () => serialized(() => silence(!audio.silence())),

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
        if (onAir.current().campaignId !== campaignId) return;
        if (onAir.clearActiveScene(sceneId)) audio.clear();
      }),

    renameMedia: (campaignId, mediaId, name) =>
      serialized(async () => {
        const renamed = await library.rename(campaignId, mediaId, name);
        const current = onAir.current();
        if (renamed.kind !== 'audio' || current.campaignId !== campaignId) return renamed;
        if (current.activeSceneId === null) return renamed;
        const active = await scenes.get(campaignId, current.activeSceneId);
        if (!active) return renamed;
        // Names travel with the mix's voices: the same mix, renamed, changes no level. The
        // picture never shows Media names, so it stays as it is.
        const media = await library.list(campaignId);
        audio.showActiveScene(active, media, 'volume', await missingAudio(active, media));
        return renamed;
      }),

    deleteMedia: (campaignId, mediaId, confirmed) =>
      serialized(async () => {
        const deleted = (await library.list(campaignId)).find((media) => media.id === mediaId);
        if (!deleted) throw new MediaError('Ce média n’existe plus.');
        const summary = ({ id, name }: Scene) => ({ id, name });
        const using = (await scenes.list(campaignId)).filter((scene) =>
          sceneUsesMedia(scene, mediaId),
        );
        const affectedPads = (await soundboards.get(campaignId)).pads
          .filter((pad) => pad.mediaId === mediaId)
          .map((pad) => ({ id: pad.id, name: pad.label ?? deleted.name }));
        if ((using.length > 0 || affectedPads.length > 0) && !confirmed) {
          return { deleted: false, affectedScenes: using.map(summary), affectedPads };
        }
        // Uses first: if the Media delete then fails, nothing points at a missing Media.
        await soundboards.removeMedia(campaignId, mediaId);
        const cleaned = await scenes.removeMediaPlacements(campaignId, mediaId);
        // Their histories could bring the deleted Media back: forget them.
        cleaned.forEach((scene) => histories.clear(campaignId, scene.id));
        await library.delete(campaignId, mediaId);
        const current = onAir.current();
        const active = cleaned.find((scene) => scene.id === current.activeSceneId);
        if (active && current.campaignId === campaignId) await showActive(active, 'stop');
        return { deleted: true, affectedScenes: cleaned.map(summary), affectedPads };
      }),
  };
}
