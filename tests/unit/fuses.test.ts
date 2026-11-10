import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { lockDownFuses } from '../../build/fuses.mjs';
import { useTempDir } from './tempDir';

// The `electron` package exports the path to the Electron binary for this platform.
const electronBinary = createRequire(import.meta.url)('electron') as string;

describe('packaged app fuses', () => {
  const dir = useTempDir();

  it('stock Electron can still run as Node (the hook has something to do)', async () => {
    const wire = await getCurrentFuseWire(electronBinary);
    expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.ENABLE);
  });

  it('locking down an Electron binary disables run-as-Node and Node debugging entry points', async () => {
    const exe = path.join(dir.path, path.basename(electronBinary));
    await fs.copyFile(electronBinary, exe);

    await lockDownFuses(exe);

    const wire = await getCurrentFuseWire(exe);
    expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
  }, 60_000);
});
