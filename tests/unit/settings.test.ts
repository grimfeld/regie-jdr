import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openStorage } from '../../core/storage';
import { createSettingsStore } from '../../core/settings';
import { useTempDir } from './tempDir';

describe('settings', () => {
  const dir = useTempDir();
  const reopen = () => createSettingsStore(openStorage(dir.path));

  it('start with the imperium home theme, no window bounds and no last Active Scene', async () => {
    expect(await reopen().get()).toEqual({
      theme: 'imperium',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
    });
  });

  it('remember the global theme across a restart', async () => {
    await reopen().setTheme('fantasy');
    expect((await reopen().get()).theme).toBe('fantasy');
  });

  it('remember each window’s bounds and each Campaign’s last Active Scene', async () => {
    const settings = reopen();
    await settings.setWindowBounds('control', { x: 10, y: 20, width: 1200, height: 800 });
    await settings.setWindowBounds('broadcast', { x: -1900, y: 0, width: 1280, height: 720 });
    await settings.setLastActiveScene('star-wars', 'cantina');
    await settings.setLastActiveScene('warhammer', 'cathedral');
    await settings.setLastActiveScene('star-wars', 'hangar');

    expect(await reopen().get()).toEqual({
      theme: 'imperium',
      windowBounds: {
        control: { x: 10, y: 20, width: 1200, height: 800 },
        broadcast: { x: -1900, y: 0, width: 1280, height: 720 },
      },
      lastActiveSceneByCampaign: { 'star-wars': 'hangar', warhammer: 'cathedral' },
    });
  });

  it('lose no change made at the same time', async () => {
    const settings = reopen();
    await Promise.all([
      settings.setTheme('retro'),
      settings.setWindowBounds('control', { x: 0, y: 0, width: 800, height: 600 }),
      settings.setLastActiveScene('star-wars', 'cantina'),
    ]);
    expect(await reopen().get()).toEqual({
      theme: 'retro',
      windowBounds: { control: { x: 0, y: 0, width: 800, height: 600 } },
      lastActiveSceneByCampaign: { 'star-wars': 'cantina' },
    });
  });

  it('drop unusable stored window bounds but keep the rest', async () => {
    const storage = openStorage(dir.path);
    await fs.writeFile(
      storage.settingsFile,
      JSON.stringify({
        schemaVersion: 1,
        theme: 'fantasy',
        windowBounds: { control: { x: 'left', y: 0, width: 800, height: 600 } },
        lastActiveSceneByCampaign: {},
      }),
    );
    expect(await reopen().get()).toEqual({
      theme: 'fantasy',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
    });
  });
});
