/**
 * The audio engine's pad channel: plays the pad sounds the main process commands
 * (core/padVoices.ts decides which play and which are cut) and reports those it holds, so the
 * Soundboard's pads light while they sound. Each Sound effect is decoded once into a buffer and
 * kept; each pad sound is a buffer source through its own gain node, played once.
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
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const sounds = new Map<PadVoiceId, PadSound>();
  let upTo: PadVoiceId = 0;

  function report() {
    const voices = [...sounds].map(([voiceId, sound]) => ({ voiceId, state: sound.state }));
    bridge.reportPads({ voices, upTo }).catch((error: unknown) => {
      console.warn('Reporting the pad sounds failed', error);
    });
  }

  /** The decoded Sound effect at `src`, loaded once and kept for later presses. */
  function bufferOf(src: string): Promise<AudioBuffer> {
    let buffer = buffers.get(src);
    if (!buffer) {
      buffer = fetch(src)
        .then((response) => {
          if (!response.ok) throw new Error(`Loading ${src} failed: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data));
      // A failed load is tried again on the next press.
      buffer.catch(() => buffers.delete(src));
      buffers.set(src, buffer);
    }
    return buffer;
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

  function apply(command: PadCommand) {
    if (context.state === 'suspended') {
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
    }
  }

  const unsubscribe = bridge.onPadCommand(apply);
  return () => {
    unsubscribe();
    cut([...sounds.keys()], 0);
  };
}
