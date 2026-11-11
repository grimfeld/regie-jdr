/**
 * The audio engine: plays the mix the main process computes (core/audioMix.ts) and reports
 * what actually sounds. It runs in the Control window (ADR-0002), outside React, so neither a
 * re-render nor the Broadcast window can disturb playback. It calls only the engine bridge
 * (`window.regieAudio`), which can receive the mix and pad commands and report, nothing else.
 * That bridge sits in the same page as the Control bridge: it narrows what the engine code
 * uses, it does not keep the rest of the page from either bridge.
 *
 * Thin by design: every decision (what sounds, at what level, how long a fade takes) is in the
 * mix. Here, each voice plays through a gain node; a voice is known by its Media and take, so
 * one in both the old and the new mix keeps playing and only ramps. A new voice fades in from its first
 * sound, not from the request, so loading never eats the fade. Voices that leave the mix fade
 * out, then are dropped. On start (and after a reload of the Control window) it reads the
 * current mix, so the current Music starts from its beginning.
 *
 * Voices loop (Music until another is picked, Ambiences always). A media element's `loop` is not
 * gapless: each loop seeks back to the start, which may be heard and fires `waiting`. So a sound
 * up to LOOP_IN_MEMORY_MAX_SECONDS long is decoded into memory and looped by a buffer source,
 * which wraps sample-accurately; a longer one streams from a media element, keeping memory low.
 *
 * Pad sounds (the Soundboard) have their own channel, src/padPlayer.ts, on the same context.
 * Where later slices plug in: load failures (#42) are already reported as 'failed'.
 */
import type { AudioEngineBridge } from '../shared/contract';
import type { AudioMix, AudioVoice, MediaId, VoiceState } from '../shared/domain';
import { latestMix } from '../core/audioMix';
import { startPadPlayer } from './padPlayer';

/**
 * Longest sound looped from memory, in seconds. Decoded audio is 32-bit float PCM at the
 * context's rate: about 23 MB a minute in stereo at 48 kHz, so a Music and a few Ambiences stay
 * well under 200 MB. The Web Audio spec expects buffers "somewhat less than a minute" long and
 * longer sounds such as music soundtracks streamed through a media element
 * (https://webaudio.github.io/web-audio-api/#AudioBuffer; MDN: "typically less than 45 s",
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer). Typical loops (rain, a crowd, a
 * short combat loop) fit; full-length Music streams, where one seam every few minutes matters
 * far less than a seam every few seconds.
 */
const LOOP_IN_MEMORY_MAX_SECONDS = 60;

/** How a voice makes sound, once its length is known. Keeps its position across pauses. */
interface Playback {
  /** Starts, or resumes where it was paused. */
  play: () => void;
  /** Stops, keeping the position. */
  pause: () => void;
  /** Stops for good and frees what it holds. */
  dispose: () => void;
}

/** What a playback tells its voice. */
interface PlaybackEvents {
  /** Sound comes out: first start, resume, or the end of a wait for data. */
  sounding: () => void;
  loading: () => void;
  paused: () => void;
  failed: () => void;
}

interface Voice {
  /** Which start of its sound (AudioVoice `take`): a new take is a new voice. */
  take: number;
  gain: GainNode;
  /** Absent while the sound's length is still being read. */
  playback?: Playback;
  /** Whether the mix wants it sounding; applied as soon as the playback exists. */
  wanted: boolean;
  state: VoiceState;
  /** Still in the mix; false while it fades out before being dropped. */
  inMix: boolean;
  /** Dropped: a playback that becomes ready afterwards is disposed at once. */
  dropped: boolean;
  /** Frees the file whose length is being read, before the playback exists. */
  release: () => void;
  /** A pause or a drop waiting for a fade-out to end. */
  pending?: ReturnType<typeof setTimeout>;
  /**
   * The fade-in waiting for a new voice's first sound: ramping while the file still loads
   * would spend the fade on silence and start the sound abruptly. Undefined once it sounded.
   */
  fadeIn?: { gain: number; fadeMs: number };
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

  function create({ src, gain: target, take }: AudioVoice, fadeMs: number): Voice {
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    // The length decides how the voice loops: read it from the file's metadata first.
    const element = new Audio();
    // Read through CORS, or Web Audio would get silence from another origin's file.
    element.crossOrigin = 'anonymous';
    element.preload = 'metadata';
    const voice: Voice = {
      take,
      gain,
      wanted: false,
      state: 'loading',
      inMix: true,
      dropped: false,
      release: () => release(element),
      fadeIn: { gain: target, fadeMs },
    };
    const events: PlaybackEvents = {
      sounding: () => {
        if (voice.fadeIn) ramp(voice, voice.fadeIn.gain, voice.fadeIn.fadeMs);
        voice.fadeIn = undefined;
        setState(voice, 'playing');
      },
      loading: () => setState(voice, 'loading'),
      paused: () => setState(voice, 'paused'),
      failed: () => setState(voice, 'failed'),
    };
    const ready = (playback: Playback) => {
      if (voice.dropped) {
        playback.dispose();
        return;
      }
      voice.playback = playback;
      if (voice.wanted) playback.play();
      else events.paused();
    };
    const failedBeforeReady = () => events.failed();
    element.addEventListener('error', failedBeforeReady);
    element.addEventListener(
      'loadedmetadata',
      () => {
        if (voice.dropped) return;
        if (element.duration > LOOP_IN_MEMORY_MAX_SECONDS) {
          element.removeEventListener('error', failedBeforeReady);
          ready(mediaPlayback(element, gain, events));
          return;
        }
        element.removeEventListener('error', failedBeforeReady);
        release(element);
        bufferPlayback(src, gain, events)
          .then(ready)
          .catch((error: unknown) => {
            console.warn('A sound could not be loaded', error);
            events.failed();
          });
      },
      { once: true },
    );
    element.src = src;
    return voice;
  }

  /** Loops `src` from memory: decoded once, then one buffer source per stretch of playing. */
  async function bufferPlayback(
    src: string,
    gain: GainNode,
    events: PlaybackEvents,
  ): Promise<Playback> {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Loading ${src} failed: ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    let source: AudioBufferSourceNode | null = null;
    /** Where the next start begins, in seconds into the sound. */
    let offset = 0;
    /** When the current source started, in context time. */
    let startedAt = 0;
    const stop = () => {
      if (!source) return;
      offset = (offset + context.currentTime - startedAt) % buffer.duration;
      source.stop();
      source.disconnect();
      source = null;
    };
    return {
      play() {
        if (source) return;
        // A source plays once; a new one resumes from the kept offset. With `loop`, it wraps
        // from the end back to the start sample-accurately: no seam, no reload.
        // https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
        // https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/loop
        source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        startedAt = context.currentTime;
        source.start(0, offset);
        events.sounding();
      },
      pause() {
        if (!source) return;
        stop();
        events.paused();
      },
      dispose: stop,
    };
  }

  /** Streams `element` and loops it with its own `loop`: for sounds too long to keep in memory. */
  function mediaPlayback(
    element: HTMLAudioElement,
    gain: GainNode,
    events: PlaybackEvents,
  ): Playback {
    element.loop = true;
    element.preload = 'auto';
    context.createMediaElementSource(element).connect(gain);
    element.addEventListener('playing', events.sounding);
    // The engine never seeks, so a seek is the loop going back to the start: its brief wait
    // for data is not a load worth showing.
    element.addEventListener('waiting', () => {
      if (!element.seeking) events.loading();
    });
    element.addEventListener('pause', events.paused);
    element.addEventListener('error', events.failed);
    return {
      play() {
        // A refused start shows as an `error` event (reported 'failed') or a later pause.
        element.play().catch(() => undefined);
      },
      pause() {
        element.pause();
      },
      dispose() {
        release(element);
      },
    };
  }

  /** Stops `element` and lets it free its file. */
  function release(element: HTMLAudioElement) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }

  /** Runs `then` once the fade is over, replacing what the voice was waiting for. */
  function after(voice: Voice, fadeMs: number, then: () => void) {
    clearTimeout(voice.pending);
    voice.pending = setTimeout(then, fadeMs);
  }

  function play(voice: Voice) {
    clearTimeout(voice.pending);
    voice.pending = undefined;
    voice.wanted = true;
    voice.playback?.play();
  }

  function pause(voice: Voice) {
    voice.wanted = false;
    voice.playback?.pause();
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
      // A new take starts the sound over: the old one fades out beside it.
      if (voice && voice.take !== wanted.take) {
        fadeOut(wanted.mediaId, voice, fadeMs);
        voice = undefined;
      }
      if (!voice) {
        voice = create(wanted, fadeMs);
        voices.set(wanted.mediaId, voice);
      }
      voice.inMix = true;
      const current = voice;
      if (wanted.playing) {
        play(current);
        // Still loading: it fades in over the change that started it, to the newest level.
        if (current.fadeIn) current.fadeIn = { ...current.fadeIn, gain: wanted.gain };
        else ramp(current, wanted.gain, fadeMs);
      } else {
        current.fadeIn = undefined;
        ramp(current, 0, fadeMs);
        after(current, fadeMs, () => pause(current));
      }
    }
    for (const [mediaId, voice] of voices) {
      if (mix.voices.some((wanted) => wanted.mediaId === mediaId)) continue;
      fadeOut(mediaId, voice, fadeMs);
    }
    report();
  }

  /** Takes a voice out of the mix: it fades out, then is dropped. */
  function fadeOut(mediaId: MediaId, voice: Voice, fadeMs: number) {
    voice.inMix = false;
    voice.fadeIn = undefined;
    ramp(voice, 0, fadeMs);
    after(voice, fadeMs, () => drop(mediaId, voice));
  }

  function drop(mediaId: MediaId, voice: Voice) {
    voice.dropped = true;
    voice.wanted = false;
    if (voice.playback) voice.playback.dispose();
    else voice.release();
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
