/**
 * The mix: what should be sounding, and at what level. Pure and Node-free; the main process
 * computes it (core/audioOnAir.ts holds the state it is computed from) and the audio engine in
 * the Control window applies it with Web Audio (src/audioEngine.ts), reporting back what
 * actually sounds.
 *
 * Where later slices plug in (spec #33):
 * - #36 Music controls: new AudioOnAirState changes (pick, pause, stop) and their AudioChange;
 *   `mixOf` already plays, pauses and drops the current Music.
 * - #37 Ambiences: `mixOf` already plays switched-on Ambiences; new SceneEdits get their
 *   AudioChange in `audioChangeOf`.
 * - #38 Activate continuity: voices are known by Media, so a Media in both mixes keeps playing.
 * - #39 Soundboard: pad gains (Master × Soundboard level × pad volume) go beside `voiceGain`.
 * - #40 Silence: a flag in AudioOnAirState that zeroes every target here.
 * - #42 missing files: leave Media known to be missing out in `audioOf`.
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
  Scene,
  VoiceState,
} from '../shared/domain.js';
import { AUDIO_FADE_MS, type AudioChange } from './fades.js';
import { isRecord } from './guards.js';
import { mediaAddress } from './mediaAddress.js';

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
}

/** The mix for `input`, fading over the duration of `change`. Its version is the holder's. */
export function mixOf(input: MixInput, change: AudioChange): Omit<AudioMix, 'version'> {
  const { scene, library, masterVolume, audio } = input;
  const voices: AudioVoice[] = [];
  if (scene) {
    const { music } = audio;
    const track = music ? audioOf(library, music.mediaId) : null;
    if (music && track && music.playback !== 'stopped') {
      voices.push(voiceOf(track, 'music', masterVolume * scene.volumes.music, music.playback));
    }
    for (const ambience of scene.ambiences) {
      const media = ambience.on ? audioOf(library, ambience.mediaId) : null;
      if (!media) continue;
      const gain = masterVolume * scene.volumes.ambience * ambience.volume;
      voices.push(voiceOf(media, 'ambience', gain, 'playing'));
    }
  }
  return { voices, fadeMs: AUDIO_FADE_MS[change] };
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
): AudioVoice {
  return {
    mediaId: media.id,
    role,
    name: media.name,
    src: mediaAddress(media),
    gain,
    playing: playback === 'playing',
  };
}

/** The current Music once a Scene is Activated: its first Music, playing; null without Music. */
export function activatedMusic(scene: Scene): AudioOnAirState['music'] {
  const first = scene.music.at(0);
  return first === undefined ? null : { mediaId: first, playback: 'playing' };
}

/** The current Music after an edit of the Active Scene: kept while still in its Music list. */
export function musicAfterEdit(
  scene: Scene,
  music: AudioOnAirState['music'],
): AudioOnAirState['music'] {
  return music && scene.music.includes(music.mediaId) ? music : null;
}

/** How a Scene edit on the Active Scene changes what is heard (its fade, AUDIO_FADE_MS). */
export function audioChangeOf(edit: SceneEdit): AudioChange {
  switch (edit.kind) {
    // Adding Music does not start it: the mix changes only if it was the current Music.
    case 'add-music':
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
 * until it does. Voices the engine still holds but the mix dropped (fading out) are not shown.
 */
export function soundingOf(mix: AudioMix, report: AudioEngineReport): AudioSounding {
  return {
    voices: mix.voices.map(({ mediaId, role, name }) => ({
      mediaId,
      role,
      name,
      state: report.voices.find((voice) => voice.mediaId === mediaId)?.state ?? 'loading',
    })),
  };
}

/** More voices than this in one report is a malformed message. */
const MAX_REPORTED_VOICES = 64;
/** Media ids longer than this are malformed. */
const MAX_ID_LENGTH = 200;
const VOICE_STATES: readonly VoiceState[] = ['loading', 'playing', 'paused', 'failed'];

function isVoiceState(value: unknown): value is VoiceState {
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
