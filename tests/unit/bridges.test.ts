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
});
