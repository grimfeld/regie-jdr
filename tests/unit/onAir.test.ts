import { describe, expect, it } from 'vitest';
import { createOnAir, latestOnAir } from '../../core/onAir';

describe('on-air state', () => {
  it('starts with nothing on air', () => {
    const onAir = createOnAir();
    expect(onAir.current()).toEqual({ campaignId: null, activeSceneId: null, version: 0 });
  });

  it('opens a Campaign with no Active Scene, then Activates a Scene, one version each', () => {
    const onAir = createOnAir();
    expect(onAir.openCampaign('star-wars')).toEqual({
      campaignId: 'star-wars',
      activeSceneId: null,
      version: 1,
    });
    expect(onAir.activateScene('cantina')).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      version: 2,
    });
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      version: 2,
    });
  });

  it('switching Campaign clears the Active Scene', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina');
    expect(onAir.openCampaign('warhammer')).toEqual({
      campaignId: 'warhammer',
      activeSceneId: null,
      version: 3,
    });
  });

  it('closing the Campaign takes everything off air', () => {
    const onAir = createOnAir();
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina');
    expect(onAir.closeCampaign()).toEqual({ campaignId: null, activeSceneId: null, version: 3 });
  });

  it('refuses to Activate a Scene when no Campaign is open, leaving the state unchanged', () => {
    const onAir = createOnAir();
    expect(() => onAir.activateScene('cantina')).toThrow(/no Campaign is open/);
    onAir.openCampaign('star-wars');
    onAir.closeCampaign();
    expect(() => onAir.activateScene('cantina')).toThrow(/no Campaign is open/);
    expect(onAir.current()).toEqual({ campaignId: null, activeSceneId: null, version: 2 });
  });

  it('tells subscribers every new snapshot until they unsubscribe', () => {
    const onAir = createOnAir();
    const seen: unknown[] = [];
    const unsubscribe = onAir.subscribe((snapshot) => seen.push(snapshot));
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina');
    unsubscribe();
    onAir.closeCampaign();
    expect(seen).toEqual([
      { campaignId: 'star-wars', activeSceneId: null, version: 1 },
      { campaignId: 'star-wars', activeSceneId: 'cantina', version: 2 },
    ]);
  });

  it('hands out snapshots that callers cannot use to change the state', () => {
    const onAir = createOnAir();
    onAir.subscribe((snapshot) => {
      snapshot.version = 99;
    });
    onAir.openCampaign('star-wars').activeSceneId = 'hacked';
    onAir.current().campaignId = 'hacked';
    expect(onAir.current()).toEqual({ campaignId: 'star-wars', activeSceneId: null, version: 1 });
  });
});

describe('the snapshot a window shows', () => {
  const v1 = { campaignId: 'star-wars', activeSceneId: null, version: 1 };
  const v2 = { campaignId: 'star-wars', activeSceneId: 'cantina', version: 2 };

  it('takes the first snapshot it receives', () => {
    expect(latestOnAir(null, v1)).toBe(v1);
  });

  it('takes a newer snapshot', () => {
    expect(latestOnAir(v1, v2)).toBe(v2);
  });

  it('ignores an older or same-version snapshot', () => {
    expect(latestOnAir(v2, v1)).toBe(v2);
    expect(latestOnAir(v2, { ...v2, activeSceneId: 'other' })).toBe(v2);
  });
});
