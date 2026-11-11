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
  /**
   * A Scene is Activated: its first Music plays, with its switched-on Ambiences. Lifts Silence.
   * `missing`: the audio Media whose file is missing, left out (here and below).
   */
  activateScene(scene: Scene, library: readonly Media[], missing: ReadonlySet<MediaId>): AudioMix;
  /**
   * The Active Scene changed (an edit, an undo, a deleted Media): it plays on as it now is;
   * the current Music stays while still in its Music list. `change` sets the fade.
   */
  showActiveScene(
    scene: Scene,
    library: readonly Media[],
    change: AudioChange,
    missing: ReadonlySet<MediaId>,
  ): AudioMix;
  /**
   * The Game Master picks a Music of the Active Scene's list: it crossfades in, playing. Never
   * saved into the Scene: the next Activate starts from its first Music again. Throws a
   * SceneError with no Active Scene or a Music not in its list.
   */
  pickMusic(mediaId: MediaId): AudioMix;
  /** Plays, pauses (keeping its position) or stops the current Music (see musicWithPlayback). */
  setMusicPlayback(playback: MusicPlayback): AudioMix;
  /**
   * Nothing plays: a Campaign opened, switched or closed, or the Active Scene deleted. Lifts
   * Silence.
   */
  clear(): AudioMix;
  /** Whether Silence is on. */
  silence(): boolean;
  /**
   * Starts (`on`) or lifts Silence: every voice fades out and pauses, then comes back as the
   * mix now is. Activating a Scene lifts it too. Pads are the caller's (core/padVoices.ts).
   */
  setSilence(on: boolean): AudioMix;
  /** The Master volume (Settings, already checked). */
  setMasterVolume(masterVolume: number): AudioMix;
  /** Calls `listener` with each new mix. Returns the unsubscribe function. */
  subscribe(listener: (mix: AudioMix) => void): () => void;
}

/** What a mix makes heard (or tells missing), to compare two mixes; its fade does not count. */
function heard({ voices, missing }: Pick<AudioMix, 'voices' | 'missing'>): string {
  return JSON.stringify({ voices, missing });
}

export function createAudioOnAir(): AudioOnAir {
  let input: MixInput = {
    scene: null,
    library: [],
    masterVolume: MASTER_VOLUME.default,
    audio: { music: null },
    missing: new Set(),
    silence: false,
  };
  let mix: AudioMix = { voices: [], missing: [], fadeMs: 0, version: 0 };
  const listeners = new Set<(mix: AudioMix) => void>();

  function change(next: MixInput, kind: AudioChange): AudioMix {
    const silenceChanged = Boolean(next.silence) !== Boolean(input.silence);
    input = next;
    const computed = mixOf(next, kind);
    // A Silence change always gives a new mix, so listeners learn of it even when nothing sounds.
    if (!silenceChanged && heard(computed) === heard(mix)) {
      return structuredClone(mix);
    }
    mix = { ...computed, version: mix.version + 1 };
    for (const listener of listeners) listener(structuredClone(mix));
    return structuredClone(mix);
  }

  return {
    mix: () => structuredClone(mix),
    activateScene: (scene, library, missing) =>
      change(
        {
          ...input,
          scene,
          library,
          missing,
          audio: { music: activatedMusic(scene) },
          silence: false,
        },
        'activate',
      ),
    showActiveScene: (scene, library, kind, missing) =>
      change(
        {
          ...input,
          scene,
          library,
          missing,
          audio: { music: musicAfterEdit(scene, input.audio.music) },
        },
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
    clear: () =>
      change(
        {
          ...input,
          scene: null,
          library: [],
          missing: new Set(),
          audio: { music: null },
          silence: false,
        },
        'stop',
      ),
    silence: () => input.silence === true,
    setSilence: (on) => change({ ...input, silence: on }, 'silence'),
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
