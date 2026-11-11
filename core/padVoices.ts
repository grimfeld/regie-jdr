/**
 * Pad sounds: what the Soundboard's pads play, managed by the main process beside the mix
 * (core/audioOnAir.ts). A press is a one-off command, not state: each press plays its Sound
 * effect once, as a new pad sound, overlapping any still sounding. At most MAX_PAD_VOICES sound
 * at once; a press beyond that cuts the oldest first, with a short fade. The audio engine plays
 * them and reports which it holds; one it no longer holds has ended. In memory only. No Node or
 * Electron dependency.
 */
import type {
  PadCommand,
  PadReport,
  PadVoiceId,
  SoundingPad,
  VoiceState,
} from '../shared/domain.js';
import { isVoiceState } from './audioMix.js';
import { AUDIO_FADE_MS, type FixedAudioChange } from './fades.js';
import { isRecord } from './guards.js';

/** Most pad sounds playing at once. */
export const MAX_PAD_VOICES = 8;

/** A pad pressed: what to play, and the pad's name for the "En cours" strip. */
export interface PadPress {
  padId: string;
  name: string;
  /** Media address of its Sound effect (`regie-media:`). */
  src: string;
  /** Its level, padGain(). */
  gain: number;
}

export interface PadVoices {
  /** A pad is pressed: the commands for the engine (a cut first when full, then the play). */
  press(press: PadPress): PadCommand[];
  /** The engine's report. Returns whether the sounding pads changed. */
  report(report: PadReport): boolean;
  /** The pads with a pad sound the engine reports playing, each once, oldest press first. */
  sounding(): SoundingPad[];
  /**
   * Cuts every pad sound, fading over `change`: everything stops (a Campaign opened, switched
   * or closed), or Silence starts. Pads pressed afterwards play as usual.
   */
  clear(change?: FixedAudioChange): PadCommand[];
  /** The engine (re)started, holding nothing: forgets every pad sound without a command. */
  forget(): void;
  /**
   * The pads' names and levels changed (a level or pad volume set, the Master volume, a pad or
   * its Media renamed): the pad sounds still sounding take them, so every level slider is heard
   * at once. `pads` gives each pad's name and padGain(); pads missing from it are left alone.
   * Returns the commands ramping each changed level.
   */
  retune(pads: ReadonlyMap<string, { name: string; gain: number }>): PadCommand[];
}

/** A pad's level: Master volume × Soundboard level × pad volume. */
export function padGain(masterVolume: number, level: number, padVolume: number): number {
  return masterVolume * level * padVolume;
}

interface PadVoice {
  voiceId: PadVoiceId;
  padId: string;
  name: string;
  /** Its level, as last sent to the engine. */
  gain: number;
  /** Loading until the engine reports it. */
  state: VoiceState;
}

export function createPadVoices(): PadVoices {
  /** Pad sounds not known to have ended, oldest first. */
  let voices: PadVoice[] = [];
  let lastId: PadVoiceId = 0;

  const soundingOf = (list: readonly PadVoice[]) => {
    const pads: SoundingPad[] = [];
    for (const { padId, name, state } of list) {
      if (state === 'playing' && !pads.some((pad) => pad.padId === padId)) {
        pads.push({ padId, name });
      }
    }
    return pads;
  };

  return {
    press({ padId, name, src, gain }) {
      lastId += 1;
      const commands: PadCommand[] = [];
      const over = voices.length + 1 - MAX_PAD_VOICES;
      if (over > 0) {
        const cut = voices.slice(0, over);
        voices = voices.slice(over);
        commands.push({
          kind: 'cut',
          voiceIds: cut.map((voice) => voice.voiceId),
          fadeMs: AUDIO_FADE_MS.pad,
        });
      }
      voices.push({ voiceId: lastId, padId, name, gain, state: 'loading' });
      commands.push({ kind: 'play', voiceId: lastId, src, gain });
      return commands;
    },

    report({ voices: reported, upTo }) {
      const before = JSON.stringify(soundingOf(voices));
      voices = voices.flatMap((voice) => {
        const known = reported.find((item) => item.voiceId === voice.voiceId);
        if (known) return [{ ...voice, state: known.state }];
        // Received by the engine and no longer held: it ended (or was cut).
        return voice.voiceId <= upTo ? [] : [voice];
      });
      return JSON.stringify(soundingOf(voices)) !== before;
    },

    sounding: () => soundingOf(voices),

    clear(change = 'stop') {
      const cut = voices.map((voice) => voice.voiceId);
      voices = [];
      return cut.length === 0
        ? []
        : [{ kind: 'cut', voiceIds: cut, fadeMs: AUDIO_FADE_MS[change] }];
    },

    forget() {
      voices = [];
    },

    retune(pads) {
      const changed = new Map<number, PadVoiceId[]>();
      voices = voices.map((voice) => {
        const pad = pads.get(voice.padId);
        if (!pad) return voice;
        if (pad.gain !== voice.gain)
          changed.set(pad.gain, [...(changed.get(pad.gain) ?? []), voice.voiceId]);
        return { ...voice, name: pad.name, gain: pad.gain };
      });
      return [...changed].map(([gain, voiceIds]) => ({
        kind: 'gain',
        voiceIds,
        gain,
        fadeMs: AUDIO_FADE_MS.volume,
      }));
    },
  };
}

/** More pad sounds than this in one report is a malformed message. */
const MAX_REPORTED_PADS = 64;

function isVoiceId(value: unknown): value is PadVoiceId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A pad report from untrusted data, keeping only its fields; or undefined. */
export function parsePadReport(value: unknown): PadReport | undefined {
  if (!isRecord(value) || !Array.isArray(value.voices) || !isVoiceId(value.upTo)) {
    return undefined;
  }
  if (value.voices.length > MAX_REPORTED_PADS) return undefined;
  const voices: PadReport['voices'] = [];
  for (const voice of value.voices as unknown[]) {
    if (!isRecord(voice) || !isVoiceId(voice.voiceId) || !isVoiceState(voice.state)) {
      return undefined;
    }
    voices.push({ voiceId: voice.voiceId, state: voice.state });
  }
  return { voices, upTo: value.upTo };
}
