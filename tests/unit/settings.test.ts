import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openStorage } from '../../core/storage';
import { createSettingsStore } from '../../core/settings';
import { useTempDir } from './tempDir';

describe('settings', () => {
  const dir = useTempDir();
  const reopen = () => createSettingsStore(openStorage(dir.path));

  it('start with the imperium home theme, no window bounds, no last Active Scene, a 0.6 s fade, a full Master volume, a 1.5 s Activate, a 2 s Music crossfade and the Broadcast window not on top', async () => {
    expect(await reopen().get()).toEqual({
      theme: 'imperium',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
      fadeDurationMs: 600,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('remember the fade duration across a restart', async () => {
    expect((await reopen().setFadeDuration(1200)).fadeDurationMs).toBe(1200);
    expect((await reopen().get()).fadeDurationMs).toBe(1200);
  });

  it('refuse a fade duration out of bounds, keeping the saved one', async () => {
    await reopen().setFadeDuration(900);
    await expect(reopen().setFadeDuration(-1)).rejects.toThrow();
    await expect(reopen().setFadeDuration(60_000)).rejects.toThrow();
    expect((await reopen().get()).fadeDurationMs).toBe(900);
  });

  it('give Settings saved before fades the default fade duration', async () => {
    const storage = openStorage(dir.path);
    await fs.writeFile(
      storage.settingsFile,
      JSON.stringify({
        schemaVersion: 1,
        theme: 'retro',
        windowBounds: {},
        lastActiveSceneByCampaign: { 'star-wars': 'cantina' },
      }),
    );
    expect(await reopen().get()).toEqual({
      theme: 'retro',
      windowBounds: {},
      lastActiveSceneByCampaign: { 'star-wars': 'cantina' },
      fadeDurationMs: 600,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('drop an unusable stored fade duration but keep the rest', async () => {
    const storage = openStorage(dir.path);
    await fs.writeFile(
      storage.settingsFile,
      JSON.stringify({
        schemaVersion: 2,
        theme: 'fantasy',
        windowBounds: {},
        lastActiveSceneByCampaign: {},
        fadeDurationMs: 'slow',
      }),
    );
    expect(await reopen().get()).toEqual({
      theme: 'fantasy',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
      fadeDurationMs: 600,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('give Settings saved before Milestone 2 a full Master volume, keeping the rest', async () => {
    const storage = openStorage(dir.path);
    await fs.writeFile(
      storage.settingsFile,
      JSON.stringify({
        schemaVersion: 2,
        theme: 'retro',
        windowBounds: {},
        lastActiveSceneByCampaign: {},
        fadeDurationMs: 900,
      }),
    );
    expect(await reopen().get()).toEqual({
      theme: 'retro',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
      fadeDurationMs: 900,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('keep a stored Master volume and drop an unusable one', async () => {
    const storage = openStorage(dir.path);
    const write = (masterVolume: unknown) =>
      fs.writeFile(
        storage.settingsFile,
        JSON.stringify({
          schemaVersion: 3,
          theme: 'retro',
          windowBounds: {},
          lastActiveSceneByCampaign: {},
          fadeDurationMs: 600,
          masterVolume,
        }),
      );
    await write(0.4);
    expect((await reopen().get()).masterVolume).toBe(0.4);
    for (const unusable of [1.5, -0.1, 'loud', null]) {
      await write(unusable);
      expect((await reopen().get()).masterVolume).toBe(1);
    }
  });

  it('remember the Master volume across a restart, and refuse one out of 0..1', async () => {
    expect((await reopen().setMasterVolume(0.4)).masterVolume).toBe(0.4);
    expect((await reopen().get()).masterVolume).toBe(0.4);
    await expect(reopen().setMasterVolume(1.5)).rejects.toThrow(
      'Le volume général doit être compris entre 0 et 100 %.',
    );
    await expect(reopen().setMasterVolume(-0.1)).rejects.toThrow();
    expect((await reopen().get()).masterVolume).toBe(0.4);
  });

  it('give Settings saved before Milestone 3 the default Activate and Music crossfade durations', async () => {
    const storage = openStorage(dir.path);
    await fs.writeFile(
      storage.settingsFile,
      JSON.stringify({
        schemaVersion: 3,
        theme: 'retro',
        windowBounds: {},
        lastActiveSceneByCampaign: {},
        fadeDurationMs: 900,
        masterVolume: 0.4,
      }),
    );
    expect(await reopen().get()).toEqual({
      theme: 'retro',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
      fadeDurationMs: 900,
      masterVolume: 0.4,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('keep stored Activate and Music crossfade durations and drop unusable ones', async () => {
    const storage = openStorage(dir.path);
    const write = (activateDurationMs: unknown, musicCrossfadeMs: unknown) =>
      fs.writeFile(
        storage.settingsFile,
        JSON.stringify({
          schemaVersion: 4,
          theme: 'retro',
          windowBounds: {},
          lastActiveSceneByCampaign: {},
          fadeDurationMs: 600,
          masterVolume: 1,
          activateDurationMs,
          musicCrossfadeMs,
        }),
      );
    await write(3000, 5000);
    expect(await reopen().get()).toMatchObject({
      activateDurationMs: 3000,
      musicCrossfadeMs: 5000,
    });
    for (const unusable of [0, 60_000, 1500.5, 'slow', null]) {
      await write(unusable, unusable);
      expect(await reopen().get()).toMatchObject({
        activateDurationMs: 1500,
        musicCrossfadeMs: 2000,
      });
    }
  });

  it('remember the Activate and Music crossfade durations across a restart', async () => {
    expect((await reopen().setActivateDuration(3000)).activateDurationMs).toBe(3000);
    expect((await reopen().setMusicCrossfade(4500)).musicCrossfadeMs).toBe(4500);
    expect(await reopen().get()).toMatchObject({
      activateDurationMs: 3000,
      musicCrossfadeMs: 4500,
    });
  });

  it('refuse Activate and Music crossfade durations out of bounds, keeping the saved ones', async () => {
    await reopen().setActivateDuration(3000);
    await reopen().setMusicCrossfade(4500);
    await expect(reopen().setActivateDuration(50)).rejects.toThrow(
      'La durée d’activation doit être comprise entre 0.1 et 5 secondes.',
    );
    await expect(reopen().setActivateDuration(5001)).rejects.toThrow();
    await expect(reopen().setMusicCrossfade(10_001)).rejects.toThrow(
      'La durée du fondu entre musiques doit être comprise entre 0.1 et 10 secondes.',
    );
    await expect(reopen().setMusicCrossfade(-1)).rejects.toThrow();
    expect(await reopen().get()).toMatchObject({
      activateDurationMs: 3000,
      musicCrossfadeMs: 4500,
    });
  });

  describe('bring version 4 Settings to version 5, whichever milestone wrote them', () => {
    const version4 = (fields: object) => ({
      schemaVersion: 4,
      theme: 'retro',
      windowBounds: {},
      lastActiveSceneByCampaign: {},
      fadeDurationMs: 900,
      masterVolume: 0.4,
      ...fields,
    });
    const migrated = async (fields: object) => {
      const storage = openStorage(dir.path);
      await fs.writeFile(storage.settingsFile, JSON.stringify(version4(fields)));
      const settings = await reopen().setTheme('retro');
      const stored: unknown = JSON.parse(await fs.readFile(storage.settingsFile, 'utf8'));
      return { settings, stored };
    };

    it('Milestone 3 (the durations): keeps them, the Broadcast window not on top', async () => {
      const { settings, stored } = await migrated({
        activateDurationMs: 3000,
        musicCrossfadeMs: 5000,
      });
      expect(settings).toEqual({
        theme: 'retro',
        windowBounds: {},
        lastActiveSceneByCampaign: {},
        fadeDurationMs: 900,
        masterVolume: 0.4,
        activateDurationMs: 3000,
        musicCrossfadeMs: 5000,
        broadcastAlwaysOnTop: false,
      });
      expect(stored).toMatchObject({ schemaVersion: 5, broadcastAlwaysOnTop: false });
    });

    it('an early Milestone 4 build (always on top only): keeps it, default durations', async () => {
      const { settings, stored } = await migrated({ broadcastAlwaysOnTop: true });
      expect(settings).toMatchObject({
        activateDurationMs: 1500,
        musicCrossfadeMs: 2000,
        broadcastAlwaysOnTop: true,
      });
      expect(stored).toMatchObject({
        schemaVersion: 5,
        activateDurationMs: 1500,
        musicCrossfadeMs: 2000,
        broadcastAlwaysOnTop: true,
      });
    });
  });

  it('keep a stored Broadcast always-on-top choice and drop an unusable one', async () => {
    const storage = openStorage(dir.path);
    const write = (broadcastAlwaysOnTop: unknown) =>
      fs.writeFile(
        storage.settingsFile,
        JSON.stringify({
          schemaVersion: 5,
          theme: 'imperium',
          windowBounds: {},
          lastActiveSceneByCampaign: {},
          fadeDurationMs: 600,
          masterVolume: 1,
          activateDurationMs: 1500,
          musicCrossfadeMs: 2000,
          broadcastAlwaysOnTop,
        }),
      );
    await write(true);
    expect((await reopen().get()).broadcastAlwaysOnTop).toBe(true);
    for (const unusable of ['yes', 1, null]) {
      await write(unusable);
      expect((await reopen().get()).broadcastAlwaysOnTop).toBe(false);
    }
  });

  it('remember the Broadcast always-on-top choice across a restart', async () => {
    expect((await reopen().setBroadcastAlwaysOnTop(true)).broadcastAlwaysOnTop).toBe(true);
    expect((await reopen().get()).broadcastAlwaysOnTop).toBe(true);
    expect((await reopen().setBroadcastAlwaysOnTop(false)).broadcastAlwaysOnTop).toBe(false);
    expect((await reopen().get()).broadcastAlwaysOnTop).toBe(false);
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
      fadeDurationMs: 600,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });

  it('forget a deleted Scene as its Campaign’s last Active Scene, and only that one', async () => {
    const settings = reopen();
    await settings.setLastActiveScene('star-wars', 'cantina');
    await settings.setLastActiveScene('warhammer', 'cathedral');

    await settings.forgetScene('star-wars', 'hangar');
    await settings.forgetScene('warhammer', 'cantina');
    expect((await reopen().get()).lastActiveSceneByCampaign).toEqual({
      'star-wars': 'cantina',
      warhammer: 'cathedral',
    });

    await settings.forgetScene('star-wars', 'cantina');
    expect((await reopen().get()).lastActiveSceneByCampaign).toEqual({ warhammer: 'cathedral' });
  });

  it('forget a deleted Campaign entirely, keeping the other Campaigns', async () => {
    const settings = reopen();
    await settings.setLastActiveScene('star-wars', 'cantina');
    await settings.setLastActiveScene('warhammer', 'cathedral');

    await settings.forgetCampaign('star-wars');
    await settings.forgetCampaign('never-seen');

    expect((await reopen().get()).lastActiveSceneByCampaign).toEqual({ warhammer: 'cathedral' });
  });

  it('lose no change made at the same time', async () => {
    const settings = reopen();
    await Promise.all([
      settings.setTheme('retro'),
      settings.setWindowBounds('control', { x: 0, y: 0, width: 800, height: 600 }),
      settings.setLastActiveScene('star-wars', 'cantina'),
      settings.setFadeDuration(1000),
    ]);
    expect(await reopen().get()).toEqual({
      theme: 'retro',
      windowBounds: { control: { x: 0, y: 0, width: 800, height: 600 } },
      lastActiveSceneByCampaign: { 'star-wars': 'cantina' },
      fadeDurationMs: 1000,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
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
      fadeDurationMs: 600,
      masterVolume: 1,
      activateDurationMs: 1500,
      musicCrossfadeMs: 2000,
      broadcastAlwaysOnTop: false,
    });
  });
});
