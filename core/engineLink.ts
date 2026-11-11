/**
 * The main process's side of the audio engine (ADR-0002: it runs in the Control window): what
 * the engine last reported, and so what is sounding for the "En cours" strip. The engine starts
 * again with each load of the Control window, holding nothing: its last report and its pad
 * sounds are forgotten then, so a report from before a reload never shows as sounding (nor lets
 * listening start, core/audioMix.ts `listeningAllowed`). In memory only. No Node or Electron
 * dependency.
 */
import type { AudioEngineReport, AudioSounding } from '../shared/domain.js';
import { soundingOf } from './audioMix.js';
import type { AudioOnAir } from './audioOnAir.js';
import type { PadVoices } from './padVoices.js';

export interface EngineLink {
  /** The engine (re)started with a load of the Control window: it holds nothing yet. */
  engineStarted(): void;
  /** The engine's report on the voices of the mix. */
  engineReported(report: AudioEngineReport): void;
  /** What is sounding: the mix as the engine reports it, pads, Silence, the Master volume. */
  sounding(): AudioSounding;
}

export function createEngineLink(
  audio: Pick<AudioOnAir, 'mix' | 'silence' | 'masterVolume'>,
  pads: Pick<PadVoices, 'sounding' | 'forget'>,
): EngineLink {
  let report: AudioEngineReport = { voices: [] };
  return {
    engineStarted() {
      report = { voices: [] };
      pads.forget();
    },
    engineReported(next) {
      report = next;
    },
    sounding: () =>
      soundingOf(audio.mix(), report, pads.sounding(), audio.silence(), audio.masterVolume()),
  };
}
