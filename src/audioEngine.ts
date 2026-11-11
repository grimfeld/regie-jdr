/**
 * The audio engine: plays the mix the main process computes (core/audioMix.ts) and reports
 * what actually sounds. It runs in the Control window (ADR-0002), outside React, so neither a
 * re-render nor the Broadcast window can disturb playback; it talks to the main process only
 * through its own bridge, which can receive the mix and report, nothing else.
 *
 * Thin by design: every decision (what sounds, at what level, how long a fade takes) is in the
 * mix. Here, each voice is a streamed media element routed through a gain node; a voice is
 * known by its Media, so one in both the old and the new mix keeps playing and only ramps.
 * Voices that leave the mix fade out, then are dropped. On start (and after a reload of the
 * Control window) it reads the current mix, so the current Music starts from its beginning.
 *
 * Pad sounds (the Soundboard) have their own channel, src/padPlayer.ts, on the same context.
 * Where later slices plug in: load failures (#42) are already reported as 'failed'.
 */
import type { AudioEngineBridge } from '../shared/contract';
import type { AudioMix, AudioVoice, MediaId, VoiceState } from '../shared/domain';
import { latestMix } from '../core/audioMix';
import { startPadPlayer } from './padPlayer';

interface Voice {
  element: HTMLAudioElement;
  gain: GainNode;
  state: VoiceState;
  /** Still in the mix; false while it fades out before being dropped. */
  inMix: boolean;
  /** A pause or a drop waiting for a fade-out to end. */
  pending?: ReturnType<typeof setTimeout>;
}

/** Starts the engine on `bridge`. Returns the function that stops it and silences everything. */
export function startAudioEngine(bridge: AudioEngineBridge): () => void {
  const context = new AudioContext();
  const voices = new Map<MediaId, Voice>();
  let applied: AudioMix | null = null;

  function report() {
    const reported = [...voices]
      .filter(([, voice]) => voice.inMix)
      .map(([mediaId, voice]) => ({ mediaId, state: voice.state }));
    bridge.report({ voices: reported }).catch((error: unknown) => {
      console.warn('Reporting what sounds failed', error);
    });
  }

  function setState(voice: Voice, state: VoiceState) {
    if (voice.state === state) return;
    voice.state = state;
    if (voice.inMix) report();
  }

  /** Ramps a voice's level from where it is to `target` over `fadeMs`. */
  function ramp(voice: Voice, target: number, fadeMs: number) {
    const { gain } = voice.gain;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(Math.min(1, Math.max(0, target)), now + fadeMs / 1000);
  }

  function create({ src }: AudioVoice): Voice {
    const element = new Audio();
    // Read through CORS, or Web Audio would get silence from another origin's file.
    element.crossOrigin = 'anonymous';
    element.loop = true;
    element.preload = 'auto';
    const gain = context.createGain();
    gain.gain.value = 0;
    context.createMediaElementSource(element).connect(gain).connect(context.destination);
    const voice: Voice = { element, gain, state: 'loading', inMix: true };
    element.addEventListener('playing', () => setState(voice, 'playing'));
    element.addEventListener('waiting', () => setState(voice, 'loading'));
    element.addEventListener('pause', () => setState(voice, 'paused'));
    element.addEventListener('error', () => setState(voice, 'failed'));
    element.src = src;
    return voice;
  }

  /** Runs `then` once the fade is over, replacing what the voice was waiting for. */
  function after(voice: Voice, fadeMs: number, then: () => void) {
    clearTimeout(voice.pending);
    voice.pending = setTimeout(then, fadeMs);
  }

  function play(voice: Voice) {
    clearTimeout(voice.pending);
    voice.pending = undefined;
    // A refused start shows as an `error` event (reported 'failed') or a later pause.
    voice.element.play().catch(() => undefined);
  }

  function apply(incoming: AudioMix) {
    const mix = latestMix(applied, incoming);
    if (mix === applied) return;
    applied = mix;
    if (context.state === 'suspended') {
      context.resume().catch((error: unknown) => console.warn('Starting audio failed', error));
    }
    const { fadeMs } = mix;
    for (const wanted of mix.voices) {
      let voice = voices.get(wanted.mediaId);
      if (!voice) {
        voice = create(wanted);
        voices.set(wanted.mediaId, voice);
      }
      voice.inMix = true;
      const current = voice;
      if (wanted.playing) {
        play(current);
        ramp(current, wanted.gain, fadeMs);
      } else {
        ramp(current, 0, fadeMs);
        after(current, fadeMs, () => current.element.pause());
      }
    }
    for (const [mediaId, voice] of voices) {
      if (mix.voices.some((wanted) => wanted.mediaId === mediaId)) continue;
      voice.inMix = false;
      ramp(voice, 0, fadeMs);
      after(voice, fadeMs, () => drop(mediaId, voice));
    }
    report();
  }

  function drop(mediaId: MediaId, voice: Voice) {
    voice.element.pause();
    voice.element.removeAttribute('src');
    voice.element.load();
    voice.gain.disconnect();
    if (voices.get(mediaId) === voice) voices.delete(mediaId);
  }

  const stopPads = startPadPlayer(context, bridge);
  // Subscribe first, then read the current mix: nothing is missed in between.
  const unsubscribe = bridge.onMixChanged(apply);
  bridge
    .getMix()
    .then(apply)
    .catch((error: unknown) => console.error('Reading the mix failed', error));

  return () => {
    unsubscribe();
    stopPads();
    for (const [mediaId, voice] of voices) {
      clearTimeout(voice.pending);
      drop(mediaId, voice);
    }
    context.close().catch(() => undefined);
  };
}
