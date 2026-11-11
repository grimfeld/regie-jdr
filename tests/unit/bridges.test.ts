import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { invokeChannels, sendersOf } from '../../core/ipc';

/**
 * The sender rules in core/ipc.ts and the preload bridges are written separately; these tests
 * keep them in step. The preloads are sandboxed and cannot be imported here, so their source
 * is read: every channel a bridge calls appears as `invoke('<channel>'`.
 */
function channelsInvokedBy(preload: string): string[] {
  const source = readFileSync(new URL(`../../electron/${preload}`, import.meta.url), 'utf8');
  return [...source.matchAll(/\binvoke\(\s*'([^']+)'/g)].map((match) => match[1]);
}

describe('sender rules and bridges', () => {
  it('lets the Broadcast window call exactly the channels its read-only bridge calls', () => {
    const allowed = invokeChannels.filter((channel) => sendersOf(channel).includes('broadcast'));
    const called = channelsInvokedBy('preload-broadcast.ts');
    expect(called.length).toBeGreaterThan(0);
    expect(new Set(called)).toEqual(new Set(allowed));
  });

  it('lets the Control window call every channel, and its bridge calls each one', () => {
    for (const channel of invokeChannels) expect(sendersOf(channel)).toContain('control');
    expect(new Set(channelsInvokedBy('preload-control.ts'))).toEqual(new Set(invokeChannels));
  });

  it('keeps the Broadcast window to reads: no channel it may call changes anything', () => {
    // A channel the Broadcast window may call must be a read. Widening this list is a decision
    // about the broadcast projection (CODING_STANDARDS.md, "The window contract").
    const reads = ['onAir:get'];
    const allowed = invokeChannels.filter((channel) => sendersOf(channel).includes('broadcast'));
    expect(allowed).toEqual(reads);
  });

  it('gives the audio engine a bridge that only reads the mix and pad commands and reports what sounds', () => {
    const source = readFileSync(
      new URL('../../electron/preload-control.ts', import.meta.url),
      'utf8',
    );
    const engineBridge = /const audioEngine: AudioEngineBridge = \{([^}]*)\};/.exec(source)?.[1];
    expect(engineBridge).toBeDefined();
    const called = [...(engineBridge ?? '').matchAll(/\b(?:invoke|subscribe)\(\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(called.sort()).toEqual([
      'audio:get-mix',
      'audio:mix-changed',
      'audio:pad-command',
      'audio:report',
      'audio:report-pads',
    ]);
  });
});
