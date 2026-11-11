/**
 * The audio engine's pad channel: plays the pad sounds the main process commands
 * (core/padVoices.ts decides which play and which are cut) and reports those it holds, so the
 * Soundboard's pads light while they sound. The Sound effects of the open Campaign's pads are
 * decoded ahead of a press and kept while they are on a pad (the main process's `preload`
 * command, spec #33); every other is freed. Each pad sound is a buffer source through its own
 * gain node, played once.
 */
import type { AudioEngineBridge } from '../shared/contract';
import type { PadCommand, PadVoiceId, VoiceState } from '../shared/domain';

interface PadSound {
  gain: GainNode;
  state: VoiceState;
  /** Absent while its Sound effect is still loading. */
  source?: AudioBufferSourceNode;
}

/**
 * Starts the pad channel on `context`. Returns the function that stops it and silences its pad
 * sounds.
 */
export function startPadPlayer(
  context: AudioContext,
  bridge: Pick<AudioEngineBridge, 'onPadCommand' | 'reportPads'>,
): () => void {
  /** The decoded Sound effects kept, by Media address: only those of `preloaded`. */
  const buffers = new Map<string, Promise<AudioBuffer>>();
  /** The Sound effects of the open Campaign's pads, as last told. */
  let preloaded = new Set<string>();
  const sounds = new Map<PadVoiceId, PadSound>();
  let upTo: PadVoiceId = 0;

  function report() {
    const voices = [...sounds].map(([voiceId, sound]) => ({ voiceId, state: sound.state }));
    bridge.reportPads({ voices, upTo }).catch((error: unknown) => {
      console.warn('Reporting the pad sounds failed', error);
    });
  }

  /**
   * The decoded Sound effect at `src`: kept for later presses while it is on a pad, decoded for
   * this press only otherwise (a pad removed meanwhile).
   */
  function bufferOf(src: string): Promise<AudioBuffer> {
    const kept = buffers.get(src);
    if (kept) return kept;
    const buffer = fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`Loading ${src} failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data));
    if (preloaded.has(src)) {
      buffers.set(src, buffer);
      // A failed load is tried again on the next press.
      buffer.catch(() => {
        if (buffers.get(src) === buffer) buffers.delete(src);
      });
    }
    return buffer;
  }

  /** Keeps exactly the Sound effects `srcs` decoded: frees the others, decodes the new ones. */
  function preload(srcs: readonly string[]) {
    preloaded = new Set(srcs);
    for (const src of buffers.keys()) {
      if (!preloaded.has(src)) buffers.delete(src);
    }
    for (const src of preloaded) {
      bufferOf(src).catch((error: unknown) => {
        console.warn('A Sound effect could not be preloaded', error);
      });
    }
  }

  function end(voiceId: PadVoiceId, sound: PadSound) {
    sound.gain.disconnect();
    if (sounds.get(voiceId) === sound) {
      sounds.delete(voiceId);
      report();
    }
  }

  async function play(voiceId: PadVoiceId, src: string, gainValue: number) {
    const gain = context.createGain();
    gain.gain.value = Math.min(1, Math.max(0, gainValue));
    gain.connect(context.destination);
    const sound: PadSound = { gain, state: 'loading' };
    sounds.set(voiceId, sound);
    report();
    let buffer: AudioBuffer;
    try {
      buffer = await bufferOf(src);
    } catch (error) {
      console.warn('A Sound effect could not be played', error);
      end(voiceId, sound);
      return;
    }
    // Cut while it was loading.
    if (sounds.get(voiceId) !== sound) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.addEventListener('ended', () => end(voiceId, sound));
    sound.source = source;
    sound.state = 'playing';
    source.start();
    report();
  }

  function cut(voiceIds: readonly PadVoiceId[], fadeMs: number) {
    const now = context.currentTime;
    for (const voiceId of voiceIds) {
      const sound = sounds.get(voiceId);
      if (!sound) continue;
      sounds.delete(voiceId);
      const { gain } = sound.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      if (sound.source) sound.source.stop(now + fadeMs / 1000);
      else sound.gain.disconnect();
    }
    report();
  }

  /** Ramps pad sounds to a new level: they keep playing. */
  function regain(voiceIds: readonly PadVoiceId[], target: number, fadeMs: number) {
    const now = context.currentTime;
    for (const voiceId of voiceIds) {
      const sound = sounds.get(voiceId);
      if (!sound) continue;
      const { gain } = sound.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(Math.min(1, Math.max(0, target)), now + fadeMs / 1000);
    }
  }

  function apply(command: PadCommand) {
    // Decoding needs no running context: a preload alone does not start audio.
    if (context.state === 'suspended' && command.kind !== 'preload') {
      context.resume().catch((error: unknown) => console.warn('Starting audio failed', error));
    }
    switch (command.kind) {
      case 'play':
        upTo = Math.max(upTo, command.voiceId);
        void play(command.voiceId, command.src, command.gain);
        return;
      case 'cut':
        cut(command.voiceIds, command.fadeMs);
        return;
      case 'preload':
        preload(command.srcs);
        return;
      case 'gain':
        regain(command.voiceIds, command.gain, command.fadeMs);
        return;
    }
  }

  const unsubscribe = bridge.onPadCommand(apply);
  return () => {
    unsubscribe();
    cut([...sounds.keys()], 0);
  };
}
