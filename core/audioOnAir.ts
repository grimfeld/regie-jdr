/**
 * The audio part of the on-air state (AudioOnAirState) and the mix computed from it, owned by
 * the main process beside core/onAir.ts. In memory only: after a restart nothing plays. No Node
 * or Electron dependency.
 *
 * The on-air commands (core/onAirCommands.ts) tell it what the Active Scene is; the Master
 * volume comes from Settings. Every change to what should sound gives a new mix with a higher
 * version; a change that alters nothing heard (a picture edit) gives none.
 */
import type { AudioMix, Media, MediaId, MusicPlayback, Scene } from '../shared/domain.js';
import {
  activatedMusic,
  MASTER_VOLUME,
  mixOf,
  musicAfterEdit,
  musicWithPlayback,
  pickedMusic,
  type MixInput,
} from './audioMix.js';
import type { AudioChange } from './fades.js';

export interface AudioOnAir {
  /** The current mix. */
  mix(): AudioMix;
  /** A Scene is Activated: its first Music plays, with its switched-on Ambiences. */
  activateScene(scene: Scene, library: readonly Media[]): AudioMix;
  /**
   * The Active Scene changed (an edit, an undo, a deleted Media): it plays on as it now is;
   * the current Music stays while still in its Music list. `change` sets the fade.
   */
  showActiveScene(scene: Scene, library: readonly Media[], change: AudioChange): AudioMix;
  /**
   * The Game Master picks a Music of the Active Scene's list: it crossfades in, playing. Never
   * saved into the Scene: the next Activate starts from its first Music again. Throws a
   * SceneError with no Active Scene or a Music not in its list.
   */
  pickMusic(mediaId: MediaId): AudioMix;
  /** Plays, pauses (keeping its position) or stops the current Music (see musicWithPlayback). */
  setMusicPlayback(playback: MusicPlayback): AudioMix;
  /** Nothing plays: a Campaign opened, switched or closed, or the Active Scene deleted. */
  clear(): AudioMix;
  /** The Master volume (Settings, already checked). */
  setMasterVolume(masterVolume: number): AudioMix;
  /** Calls `listener` with each new mix. Returns the unsubscribe function. */
  subscribe(listener: (mix: AudioMix) => void): () => void;
}

export function createAudioOnAir(): AudioOnAir {
  let input: MixInput = {
    scene: null,
    library: [],
    masterVolume: MASTER_VOLUME.default,
    audio: { music: null },
  };
  let mix: AudioMix = { voices: [], fadeMs: 0, version: 0 };
  const listeners = new Set<(mix: AudioMix) => void>();

  function change(next: MixInput, kind: AudioChange): AudioMix {
    input = next;
    const computed = mixOf(next, kind);
    if (JSON.stringify(computed.voices) === JSON.stringify(mix.voices)) {
      return structuredClone(mix);
    }
    mix = { ...computed, version: mix.version + 1 };
    for (const listener of listeners) listener(structuredClone(mix));
    return structuredClone(mix);
  }

  return {
    mix: () => structuredClone(mix),
    activateScene: (scene, library) =>
      change({ ...input, scene, library, audio: { music: activatedMusic(scene) } }, 'activate'),
    showActiveScene: (scene, library, kind) =>
      change(
        { ...input, scene, library, audio: { music: musicAfterEdit(scene, input.audio.music) } },
        kind,
      ),
    pickMusic: (mediaId) => {
      const music = pickedMusic(input.scene, mediaId);
      const same = input.audio.music?.mediaId === mediaId;
      return change({ ...input, audio: { music } }, same ? 'pause' : 'crossfade');
    },
    setMusicPlayback: (playback) =>
      change(
        { ...input, audio: { music: musicWithPlayback(input.scene, input.audio.music, playback) } },
        'pause',
      ),
    clear: () => change({ ...input, scene: null, library: [], audio: { music: null } }, 'stop'),
    setMasterVolume: (masterVolume) => change({ ...input, masterVolume }, 'volume'),
    subscribe: (listener) => {
      const own = (snapshot: AudioMix) => listener(snapshot);
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
}
