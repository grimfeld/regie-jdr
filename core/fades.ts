/**
 * Fades: how long showing and hiding takes, and what the renderer keeps drawing while an item
 * fades out. All fade timing lives here: the fade, Activate and Music crossfade duration
 * settings and the fixed audio fades. No Node or Electron dependency: the windows run this
 * module.
 */
import type { Settings } from '../shared/domain.js';

/** The fade duration setting, in milliseconds: its default and its bounds (0: no fade). */
export const FADE_DURATION_MS = { default: 600, min: 0, max: 3000 } as const;

/** A fade duration in whole milliseconds within the bounds, or undefined. */
export function parseFadeDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < FADE_DURATION_MS.min || value > FADE_DURATION_MS.max) return undefined;
  return value;
}

/**
 * The Activate duration setting, in milliseconds: how long Activating a Scene with a Crossfade
 * takes, the picture's dissolve and the audio fade alike, so sound and picture change together.
 * At least a tenth of a second, so the audio never clicks (a Cut is the instant change).
 */
export const ACTIVATE_DURATION_MS = { default: 1500, min: 100, max: 5000 } as const;

/**
 * The Music crossfade duration setting, in milliseconds: how long picking another track of the
 * Active Scene's Music list crossfades.
 */
export const MUSIC_CROSSFADE_MS = { default: 2000, min: 100, max: 10000 } as const;

/** A whole number of milliseconds within `bounds`, or undefined. */
function durationWithin(
  bounds: { readonly min: number; readonly max: number },
  value: unknown,
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < bounds.min || value > bounds.max) return undefined;
  return value;
}

/** An Activate duration in whole milliseconds within ACTIVATE_DURATION_MS, or undefined. */
export function parseActivateDuration(value: unknown): number | undefined {
  return durationWithin(ACTIVATE_DURATION_MS, value);
}

/** A Music crossfade duration in whole milliseconds within MUSIC_CROSSFADE_MS, or undefined. */
export function parseMusicCrossfade(value: unknown): number | undefined {
  return durationWithin(MUSIC_CROSSFADE_MS, value);
}

/** Seconds as typed: digits, with at most one decimal comma (French) or dot. */
const SECONDS_TEXT = /^\s*(\d*)(?:[.,](\d*))?\s*$/;

/**
 * The whole milliseconds a duration typed in seconds stands for ("4,5" and "4.5" both give
 * 4500), or undefined when the text is not a number of seconds. Bounds are the parse functions'
 * business.
 */
export function millisecondsOfSecondsText(text: string): number | undefined {
  const match = SECONDS_TEXT.exec(text);
  if (!match) return undefined;
  const [, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return undefined;
  return Math.round(Number(`${whole || '0'}.${fraction || '0'}`) * 1000);
}

/** Milliseconds as the seconds a duration field shows, with a French decimal comma. */
export function secondsTextOf(milliseconds: number): string {
  return String(milliseconds / 1000).replace('.', ',');
}

/**
 * The durations the Game Master sets for changes during play (Settings): the Activate duration
 * and the Music crossfade duration.
 */
export type PlayDurations = Pick<Settings, 'activateDurationMs' | 'musicCrossfadeMs'>;

/** The play durations until the Game Master changes them. */
export const DEFAULT_PLAY_DURATIONS: PlayDurations = {
  activateDurationMs: ACTIVATE_DURATION_MS.default,
  musicCrossfadeMs: MUSIC_CROSSFADE_MS.default,
};

/**
 * How long each fixed kind of audio change takes, in milliseconds. Activating with a Crossfade
 * and picking another track take the play durations instead (`audioFadeMs`). The audio engine
 * fades new voices in, ramps changed ones and fades out voices that left over the duration the
 * mix carries (core/audioMix.ts picks it).
 */
export const AUDIO_FADE_MS = {
  /**
   * Activating a Scene with a Cut: the picture changes at once, the audio switches over this
   * very short fade so nothing clicks.
   */
  cut: 100,
  /** Switching an Ambience on or off. */
  ambience: 1000,
  /** Pausing, resuming or stopping the Music, or removing it from the Active Scene. */
  pause: 300,
  /** Silence on or off. */
  silence: 500,
  /** A volume change (Master, a Scene level, an Ambience): a short ramp, so nothing clicks. */
  volume: 150,
  /** Undo or redo on the Active Scene changing what is heard. */
  undo: 1000,
  /** Everything stops: a Campaign opened, switched or closed, the Active Scene deleted. */
  stop: 300,
  /** A pad sound cut to make room for a new one (core/padVoices.ts). */
  pad: 80,
} as const;

/** A kind of audio change with a fixed fade (AUDIO_FADE_MS). */
export type FixedAudioChange = keyof typeof AUDIO_FADE_MS;

/**
 * The kind of change a new mix makes, which sets how long it fades: `activate` (a Scene
 * Activated with a Crossfade: the outgoing Scene's audio fades out, the new one's fades in) and
 * `crossfade` (picking another track of the Active Scene's Music list) take the play durations,
 * the others AUDIO_FADE_MS.
 */
export type AudioChange = FixedAudioChange | 'activate' | 'crossfade';

/** How long `change` fades, in milliseconds, with the play durations `durations`. */
export function audioFadeMs(change: AudioChange, durations: PlayDurations): number {
  if (change === 'activate') return durations.activateDurationMs;
  if (change === 'crossfade') return durations.musicCrossfadeMs;
  return AUDIO_FADE_MS[change];
}

/** An item the renderer draws: shown, or `leaving` (fading out, as it was last drawn). */
export interface Fading<T> {
  key: string;
  item: T;
  leaving: boolean;
}

/**
 * What to draw after `next` replaces what is drawn (`drawn`): every item of `next`, in order,
 * plus each drawn item missing from it, kept as it was last drawn and marked `leaving`, at its
 * place in the stack (just above the item it was drawn above, or at the bottom). The
 * Broadcast window never receives a Hidden item, so its fade-out uses that last snapshot.
 */
export function withLeaving<T>(
  drawn: readonly Fading<T>[],
  next: readonly T[],
  keyOf: (item: T) => string,
): Fading<T>[] {
  const result: Fading<T>[] = next.map((item) => ({ key: keyOf(item), item, leaving: false }));
  const kept = new Set(result.map((entry) => entry.key));
  drawn.forEach((entry, index) => {
    if (kept.has(entry.key)) return;
    const below = drawn
      .slice(0, index)
      .reverse()
      .find((other) => kept.has(other.key));
    const at = below ? result.findIndex((other) => other.key === below.key) + 1 : 0;
    result.splice(at, 0, { ...entry, leaving: true });
    kept.add(entry.key);
  });
  return result;
}

/** What to draw once the leaving items have faded out. */
export function withoutLeaving<T>(drawn: readonly Fading<T>[]): Fading<T>[] {
  return drawn.filter((entry) => !entry.leaving);
}

/**
 * A picture a renderer draws during Transitions, as one layer over a black backdrop. The newest
 * layer is on top: `waiting` (transparent) until its images are decoded, then `dissolving` (fading
 * in over `durationMs`), then `shown`, when it is drawn alone. A layer a newer Transition covers
 * mid-dissolve is `frozen`: its fade pauses where it is, so the new Transition starts from the
 * frame on screen. Each layer is opaque black underneath, so a dissolve mixes the two pictures
 * with no dip, and what both share (a Background, an Overlay) stays steady.
 */
export interface TransitionLayer<T> {
  /** The Transition that brought it in (Transition.id); the first picture drawn has its own. */
  key: number;
  /** The newest layer's picture follows the Active Scene; older ones stay as last drawn. */
  picture: T;
  durationMs: number;
  phase: 'shown' | 'waiting' | 'dissolving' | 'frozen';
  /** When the dissolve started (the renderer's clock), once dissolving. */
  startedAt?: number;
}

/** The first picture a renderer draws: as it is, with no dissolve (a window just opened). */
export function firstLayers<T>(key: number, picture: T): TransitionLayer<T>[] {
  return [{ key, picture, durationMs: 0, phase: 'shown' }];
}

/**
 * A new Transition `key` to `picture`: a dissolve in progress stops where it is, an incoming
 * picture still waiting for its images is dropped (nothing of it was seen), and the new picture
 * waits on top.
 */
export function withTransition<T>(
  layers: readonly TransitionLayer<T>[],
  key: number,
  picture: T,
  durationMs: number,
): TransitionLayer<T>[] {
  const kept = layers
    .filter((layer) => layer.phase !== 'waiting')
    .map((layer): TransitionLayer<T> =>
      layer.phase === 'dissolving' ? { ...layer, phase: 'frozen' } : layer,
    );
  return [...kept, { key, picture, durationMs, phase: 'waiting' }];
}

/** The newest picture's images are decoded: its dissolve starts at `now`. */
export function dissolveStarted<T>(
  layers: readonly TransitionLayer<T>[],
  key: number,
  now: number,
): TransitionLayer<T>[] {
  const newest = layers.at(-1);
  if (newest?.key !== key || newest.phase !== 'waiting') return [...layers];
  return [...layers.slice(0, -1), { ...newest, phase: 'dissolving', startedAt: now }];
}

/** The newest picture's dissolve is over: it is drawn alone. */
export function dissolveEnded<T>(
  layers: readonly TransitionLayer<T>[],
  key: number,
): TransitionLayer<T>[] {
  const newest = layers.at(-1);
  if (newest?.key !== key || newest.phase !== 'dissolving') return [...layers];
  return [{ key, picture: newest.picture, durationMs: newest.durationMs, phase: 'shown' }];
}

/** The Active Scene changed without a Transition (an edit): only the newest picture follows. */
export function withNewestPicture<T>(
  layers: readonly TransitionLayer<T>[],
  picture: T,
): TransitionLayer<T>[] {
  return layers.map((layer, index) =>
    index === layers.length - 1 ? { ...layer, picture } : layer,
  );
}
