/**
 * The mix: what should be sounding, and at what level. Pure and Node-free; the main process
 * computes it (core/audioOnAir.ts holds the state it is computed from) and the audio engine in
 * the Control window applies it with Web Audio (src/audioEngine.ts), reporting back what
 * actually sounds.
 *
 * Where later slices plug in (spec #33):
 * - #36 Music controls (done): `pickedMusic` and `musicWithPlayback` change the current Music;
 *   `mixOf` plays, pauses and drops it.
 * - #37 Ambiences: `mixOf` already plays switched-on Ambiences; new SceneEdits get their
 *   AudioChange in `audioChangeOf`.
 * - #38 Activate continuity: voices are known by Media, so a Media in both mixes keeps playing.
 * - #39 Soundboard: pad sounds are one-off commands beside the mix (core/padVoices.ts).
 * - #40 Silence: `MixInput.silence` zeroes and pauses every voice here (done).
 * - #42 missing files: Media whose file is known to be missing (`MixInput.missing`) are left
 *   out of the voices and listed as `missing`; load failures come back from the engine.
 */
import type { SceneEdit } from '../shared/contract.js';
import type {
  AudioEngineReport,
  AudioMedia,
  AudioMix,
  AudioOnAirState,
  AudioSounding,
  AudioVoice,
  Media,
  MediaId,
  MissingVoice,
  MusicPlayback,
  Scene,
  SoundingState,
  SoundingVoice,
  VoiceState,
} from '../shared/domain.js';
import { AUDIO_FADE_MS, type AudioChange } from './fades.js';
import { isRecord } from './guards.js';
import { mediaAddress } from './mediaAddress.js';
import { SceneError } from './sceneEdits.js';

/** The Master volume setting: its default and its bounds. */
export const MASTER_VOLUME = { default: 1, min: 0, max: 1 } as const;

/** What the mix is computed from. */
export interface MixInput {
  /** The Active Scene as saved; null when no Scene is active. */
  scene: Scene | null;
  /** The open Campaign's Media library. */
  library: readonly Media[];
  masterVolume: number;
  audio: AudioOnAirState;
  /** Audio Media whose file is missing (their address answers 404): never played. None if absent. */
  missing?: ReadonlySet<MediaId>;
  /**
   * Silence: every voice fades to nothing and pauses (the Music keeps its position), keeping
   * its place in the mix so lifting Silence brings the same mix back. Pads are not voices: the
   * main process cuts those sounding when Silence starts (core/padVoices.ts). Absent: off.
   */
  silence?: boolean;
}

/** The mix for `input`, fading over the duration of `change`. Its version is the holder's. */
export function mixOf(input: MixInput, change: AudioChange): Omit<AudioMix, 'version'> {
  const { scene, library, masterVolume, audio, silence, missing = new Set<MediaId>() } = input;
  const voices: AudioVoice[] = [];
  const left: MissingVoice[] = [];
  /** Plays `voice`, unless its file is missing: then it is only listed as missing. */
  const add = (voice: AudioVoice) => {
    if (!missing.has(voice.mediaId)) voices.push(voice);
    else left.push({ mediaId: voice.mediaId, role: voice.role, name: voice.name });
  };
  if (scene) {
    const { music } = audio;
    const track = music ? audioOf(library, music.mediaId) : null;
    if (music && track && music.playback !== 'stopped') {
      add(voiceOf(track, 'music', masterVolume * scene.volumes.music, music.playback, music.take));
    }
    for (const ambience of scene.ambiences) {
      const media = ambience.on ? audioOf(library, ambience.mediaId) : null;
      if (!media) continue;
      const gain = masterVolume * scene.volumes.ambience * ambience.volume;
      add(voiceOf(media, 'ambience', gain, 'playing', 0));
    }
  }
  const heard = silence ? voices.map((voice) => ({ ...voice, gain: 0, playing: false })) : voices;
  return { voices: heard, missing: left, fadeMs: AUDIO_FADE_MS[change] };
}

/** The audio Media `mediaId` of the library, or null when it is not one (deleted, an image). */
function audioOf(library: readonly Media[], mediaId: MediaId): AudioMedia | null {
  const media = library.find((item) => item.id === mediaId);
  return media?.kind === 'audio' ? media : null;
}

function voiceOf(
  media: AudioMedia,
  role: AudioVoice['role'],
  gain: number,
  playback: 'playing' | 'paused',
  take: number,
): AudioVoice {
  return {
    mediaId: media.id,
    role,
    name: media.name,
    src: mediaAddress(media),
    gain,
    playing: playback === 'playing',
    take,
  };
}

/**
 * The current Music once a Scene is Activated: its first Music, playing; null without Music.
 * When `previous` (the current Music before) is that same Media still playing, it carries on;
 * paused, it starts over, as a new take (#38: only a Music already playing carries on).
 */
export function activatedMusic(
  scene: Scene,
  previous: AudioOnAirState['music'] = null,
): AudioOnAirState['music'] {
  const first = scene.music.at(0);
  if (first === undefined) return null;
  if (previous?.mediaId !== first) return { mediaId: first, playback: 'playing', take: 0 };
  const take = previous.playback === 'playing' ? previous.take : previous.take + 1;
  return { mediaId: first, playback: 'playing', take };
}

/** The current Music after an edit of the Active Scene: kept while still in its Music list. */
export function musicAfterEdit(
  scene: Scene,
  music: AudioOnAirState['music'],
): AudioOnAirState['music'] {
  return music && scene.music.includes(music.mediaId) ? music : null;
}

/**
 * The current Music once the Game Master picks `mediaId` in the Active Scene's Music list: it
 * plays (crossfading from the one before; the current `music` itself resumes). Live playback,
 * never saved into the Scene. Throws a SceneError with no Active Scene or a Music not in its
 * list.
 */
export function pickedMusic(
  scene: Scene | null,
  mediaId: MediaId,
  music: AudioOnAirState['music'] = null,
): AudioOnAirState['music'] {
  if (!scene) throw new SceneError('Activez une scène pour choisir sa musique.');
  if (!scene.music.includes(mediaId)) {
    throw new SceneError('Cette musique n’est pas dans la scène active.');
  }
  if (music?.mediaId === mediaId) return { ...music, playback: 'playing' };
  return { mediaId, playback: 'playing', take: 0 };
}

/**
 * The current Music once played, paused or stopped. Pausing keeps its position (the engine
 * holds it); stopping drops it from the mix, so playing it again starts it over. Playing with
 * no current Music starts the Scene's first; pausing or stopping it changes nothing.
 */
export function musicWithPlayback(
  scene: Scene | null,
  music: AudioOnAirState['music'],
  playback: MusicPlayback,
): AudioOnAirState['music'] {
  if (!scene) throw new SceneError('Activez une scène pour lancer sa musique.');
  if (music) return { ...music, playback };
  if (playback !== 'playing') return null;
  const first = activatedMusic(scene);
  if (!first) throw new SceneError('La scène active n’a pas de musique.');
  return first;
}

/** How a Scene edit on the Active Scene changes what is heard (its fade, AUDIO_FADE_MS). */
export function audioChangeOf(edit: SceneEdit): AudioChange {
  switch (edit.kind) {
    // Adding or moving Music does not start it: the current Music plays on as it was.
    case 'add-music':
    case 'move-music':
      return 'volume';
    // Removing the current Music stops it, as the stop button would.
    case 'remove-music':
      return 'pause';
    case 'set-music-level':
      return 'volume';
    // A new Ambience starts off: nothing heard changes.
    case 'add-ambience':
      return 'volume';
    // Switching an Ambience on or off, or removing one, fades it in or out.
    case 'set-ambience-on':
    case 'remove-ambience':
      return 'ambience';
    case 'set-ambience-volume':
    case 'set-ambience-level':
      return 'volume';
    // Picture edits: nothing heard changes, so the mix stays as it is.
    case 'place-background':
    case 'place-overlay':
    case 'set-visible':
    case 'remove-placement':
    case 'move-background':
    case 'set-background-fit':
    case 'frame-background':
    case 'transform-overlay':
    case 'move-overlay':
    case 'rename':
    case 'set-title':
    case 'set-label-text':
    case 'set-label-visible':
      return 'volume';
  }
}

/**
 * What is sounding: each voice of `mix` with the state the engine last reported for it, loading
 * until it does, then the voices left out because their file is missing, the Soundboard `pads`
 * sounding, whether Silence is on and the Master volume. Voices the engine still holds but the mix dropped
 * (fading out) are not shown.
 */
export function soundingOf(
  mix: AudioMix,
  report: AudioEngineReport,
  pads: AudioSounding['pads'] = [],
  silence = false,
  masterVolume: number = MASTER_VOLUME.default,
): AudioSounding {
  return {
    pads,
    silence,
    masterVolume,
    voices: [
      ...mix.voices.map(({ mediaId, role, name }) => ({
        mediaId,
        role,
        name,
        state: report.voices.find((voice) => voice.mediaId === mediaId)?.state ?? 'loading',
      })),
      ...mix.missing.map((voice) => ({ ...voice, state: 'missing' as const })),
    ],
  };
}

/** Whether a voice in this state cannot be heard for good: its file is missing or unreadable. */
function isUnplayable(state: SoundingState): boolean {
  return state === 'missing' || state === 'failed';
}

/**
 * The voices of `next` that became unplayable (missing or failed) since `previous` (null
 * before the first): each is told to the Game Master once, not on every report.
 */
export function newlyUnplayable(
  previous: AudioSounding | null,
  next: AudioSounding,
): SoundingVoice[] {
  return next.voices.filter(
    (voice) =>
      isUnplayable(voice.state) &&
      !previous?.voices.some(
        (before) => before.mediaId === voice.mediaId && isUnplayable(before.state),
      ),
  );
}

/**
 * Whether the Game Master may listen to a sound of the library (#43). Discord carries every
 * sound the app plays (ADR-0002), so the players hear it too: allowed only during Silence, once
 * nothing else sounds (no voice still fading out, no pad). A voice loading during Silence is
 * held at nothing, so it does not count. Refused while `sounding` is not yet known (null).
 */
export function listeningAllowed(sounding: AudioSounding | null): boolean {
  return (
    sounding !== null &&
    sounding.silence &&
    sounding.pads.length === 0 &&
    sounding.voices.every((voice) => voice.state !== 'playing')
  );
}

/** More voices than this in one report is a malformed message. */
const MAX_REPORTED_VOICES = 64;
/** Media ids longer than this are malformed. */
const MAX_ID_LENGTH = 200;
const VOICE_STATES: readonly VoiceState[] = ['loading', 'playing', 'paused', 'failed'];

export function isVoiceState(value: unknown): value is VoiceState {
  return typeof value === 'string' && (VOICE_STATES as readonly string[]).includes(value);
}

/** An audio engine report from untrusted data, keeping only its fields; or undefined. */
export function parseAudioEngineReport(value: unknown): AudioEngineReport | undefined {
  if (!isRecord(value) || !Array.isArray(value.voices)) return undefined;
  if (value.voices.length > MAX_REPORTED_VOICES) return undefined;
  const voices: AudioEngineReport['voices'] = [];
  for (const voice of value.voices as unknown[]) {
    if (!isRecord(voice)) return undefined;
    const { mediaId, state } = voice;
    if (typeof mediaId !== 'string' || mediaId === '' || mediaId.length > MAX_ID_LENGTH) {
      return undefined;
    }
    if (!isVoiceState(state)) return undefined;
    voices.push({ mediaId, state });
  }
  return { voices };
}

/**
 * The mix the engine should apply after receiving `incoming`, given it applies `applied` (null
 * before the first): only a newer version is taken, so a late reply never replaces a newer mix.
 */
export function latestMix(applied: AudioMix | null, incoming: AudioMix): AudioMix {
  return applied === null || incoming.version > applied.version ? incoming : applied;
}
