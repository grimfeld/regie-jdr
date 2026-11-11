import { describe, expect, it } from 'vitest';
import { createOnAir, editorPictureOf, latestOnAir, onAirSceneOf } from '../../core/onAir';
import { applySceneEdit } from '../../core/sceneEdits';
import type { SceneEdit } from '../../shared/contract';
import type { Media, OnAirScene, Scene } from '../../shared/domain';
import { notesFromPlainText } from '../../core/notes';

const cantina: OnAirScene = {
  backgrounds: [
    {
      id: 'b1',
      src: 'regie-media://media/c/x.png',
      fit: 'cover',
      zoom: 1,
      focus: { x: 0.5, y: 0.5 },
    },
  ],
  overlays: [],
};
const blank: OnAirScene = { backgrounds: [], overlays: [] };
const nothing = {
  campaignId: null,
  activeSceneId: null,
  scene: null,
  blackout: false,
  fadeDurationMs: 600,
  transition: null,
};
/** The clock of the on-air state in these tests: every Transition starts at NOW. */
const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const crossfade = (id: number, from: string | null, to: string) => ({
  id,
  kind: 'crossfade',
  from,
  to,
  startedAt: NOW,
  durationMs: 1500,
});

describe('on-air state', () => {
  it('starts with nothing on air', () => {
    const onAir = createOnAir(clock);
    expect(onAir.current()).toEqual({ ...nothing, version: 0 });
  });

  it('opens a Campaign with no Active Scene, then Activates a Scene, one version each', () => {
    const onAir = createOnAir(clock);
    expect(onAir.openCampaign('star-wars')).toEqual({
      campaignId: 'star-wars',
      activeSceneId: null,
      scene: null,
      blackout: false,
      fadeDurationMs: 600,
      transition: null,
      version: 1,
    });
    expect(onAir.activateScene('cantina', cantina)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: false,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 2,
    });
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: false,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 2,
    });
  });

  it('clears the Active Scene, keeping the Campaign open and Blackout as it is', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    onAir.setBlackout(true);
    expect(onAir.clearActiveScene('cantina')).toEqual({
      campaignId: 'star-wars',
      activeSceneId: null,
      scene: null,
      blackout: true,
      fadeDurationMs: 600,
      // The latest Transition stays recorded: the renderers fade the deleted Scene out.
      transition: crossfade(1, null, 'cantina'),
      version: 4,
    });
  });

  it('leaves the state alone when clearing a Scene that is not the Active Scene', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.clearActiveScene('hangar')).toBeUndefined();
    expect(onAir.current()).toMatchObject({ activeSceneId: 'cantina', version: 2 });
  });

  it('shows the edited Active Scene as a new version', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', blank);
    expect(onAir.showActiveScene('cantina', cantina)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: false,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 3,
    });
  });

  it('ignores an edit of a Scene that is not the Active Scene', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', blank);
    expect(onAir.showActiveScene('hangar', cantina)).toBeUndefined();
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: blank,
      blackout: false,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 2,
    });
  });

  it('switching Campaign clears the Active Scene', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.openCampaign('warhammer')).toEqual({
      campaignId: 'warhammer',
      activeSceneId: null,
      scene: null,
      blackout: false,
      fadeDurationMs: 600,
      transition: null,
      version: 3,
    });
  });

  it('closing the Campaign takes everything off air', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.closeCampaign()).toEqual({ ...nothing, version: 3 });
  });

  it('carries the fade duration setting, kept when the Campaign changes', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.setFadeDuration(1500)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: false,
      fadeDurationMs: 1500,
      transition: crossfade(1, null, 'cantina'),
      version: 3,
    });
    expect(onAir.openCampaign('warhammer')).toMatchObject({ fadeDurationMs: 1500 });
    expect(onAir.closeCampaign()).toMatchObject({ fadeDurationMs: 1500 });
  });

  it('changes nothing when the fade duration is the one it has', () => {
    const onAir = createOnAir(clock);
    expect(onAir.setFadeDuration(600)).toEqual({ ...nothing, version: 0 });
  });

  it('refuses to Activate a Scene when no Campaign is open, leaving the state unchanged', () => {
    const onAir = createOnAir(clock);
    expect(() => onAir.activateScene('cantina', cantina)).toThrow(/no Campaign is open/);
    onAir.openCampaign('star-wars');
    onAir.closeCampaign();
    expect(() => onAir.activateScene('cantina', cantina)).toThrow(/no Campaign is open/);
    expect(onAir.current()).toEqual({ ...nothing, version: 2 });
  });

  it('Blackout leaves the Active Scene as it is and stays on when another Scene is Activated', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    expect(onAir.setBlackout(true)).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: true,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 3,
    });
    expect(onAir.activateScene('hangar', blank)).toMatchObject({ scene: blank, blackout: true });
    expect(onAir.showActiveScene('hangar', cantina)).toMatchObject({ blackout: true });
    expect(onAir.setBlackout(false)).toMatchObject({ activeSceneId: 'hangar', blackout: false });
  });

  it('opening, switching or closing a Campaign clears Blackout', () => {
    const onAir = createOnAir(clock);
    onAir.openCampaign('star-wars');
    onAir.setBlackout(true);
    expect(onAir.openCampaign('warhammer').blackout).toBe(false);
    onAir.setBlackout(true);
    expect(onAir.closeCampaign().blackout).toBe(false);
  });

  it('tells subscribers every new snapshot until they unsubscribe', () => {
    const onAir = createOnAir(clock);
    const seen: unknown[] = [];
    const unsubscribe = onAir.subscribe((snapshot) => seen.push(snapshot));
    onAir.openCampaign('star-wars');
    onAir.activateScene('cantina', cantina);
    unsubscribe();
    onAir.closeCampaign();
    expect(seen).toEqual([
      {
        campaignId: 'star-wars',
        activeSceneId: null,
        scene: null,
        blackout: false,
        fadeDurationMs: 600,
        transition: null,
        version: 1,
      },
      {
        campaignId: 'star-wars',
        activeSceneId: 'cantina',
        scene: cantina,
        blackout: false,
        fadeDurationMs: 600,
        transition: crossfade(1, null, 'cantina'),
        version: 2,
      },
    ]);
  });

  it('hands out snapshots that callers cannot use to change the state', () => {
    const onAir = createOnAir(clock);
    onAir.subscribe((snapshot) => {
      snapshot.version = 99;
      snapshot.scene?.backgrounds.pop();
    });
    onAir.openCampaign('star-wars');
    const activated = onAir.activateScene('cantina', cantina);
    activated.activeSceneId = 'hacked';
    activated.scene?.backgrounds.pop();
    onAir.current().campaignId = 'hacked';
    expect(onAir.current()).toEqual({
      campaignId: 'star-wars',
      activeSceneId: 'cantina',
      scene: cantina,
      blackout: false,
      fadeDurationMs: 600,
      transition: crossfade(1, null, 'cantina'),
      version: 2,
    });
  });
});

describe('a Transition on Activate', () => {
  function opened(now = clock.now) {
    const onAir = createOnAir({ now });
    onAir.openCampaign('star-wars');
    return onAir;
  }

  it('fades in from black when nothing is on air', () => {
    expect(opened().activateScene('cantina', cantina).transition).toEqual(
      crossfade(1, null, 'cantina'),
    );
  });

  it('crossfades from the Active Scene to the incoming one over the Activate duration', () => {
    const onAir = opened();
    onAir.activateScene('cantina', cantina);
    expect(onAir.activateScene('hangar', blank)).toMatchObject({
      activeSceneId: 'hangar',
      scene: blank,
      transition: crossfade(2, 'cantina', 'hangar'),
    });
  });

  it('starts a new Transition from the incoming Scene when Activated mid-Transition', () => {
    let now = NOW;
    const onAir = opened(() => now);
    onAir.activateScene('cantina', cantina);
    onAir.activateScene('hangar', blank);
    now += 500;
    expect(onAir.activateScene('cantina', cantina).transition).toEqual({
      ...crossfade(3, 'hangar', 'cantina'),
      startedAt: NOW + 500,
    });
  });

  it('runs under Blackout, leaving Blackout on', () => {
    const onAir = opened();
    onAir.activateScene('cantina', cantina);
    onAir.setBlackout(true);
    expect(onAir.activateScene('hangar', blank)).toMatchObject({
      blackout: true,
      transition: crossfade(2, 'cantina', 'hangar'),
    });
  });

  it('starts no Transition for an edit of the Active Scene, Blackout or the fade duration', () => {
    const onAir = opened();
    const { transition } = onAir.activateScene('cantina', blank);
    expect(onAir.showActiveScene('cantina', cantina)?.transition).toEqual(transition);
    expect(onAir.setBlackout(true).transition).toEqual(transition);
    expect(onAir.setFadeDuration(900).transition).toEqual(transition);
  });

  it('forgets the latest Transition when the Campaign changes, and keeps counting', () => {
    const onAir = opened();
    onAir.activateScene('cantina', cantina);
    expect(onAir.openCampaign('warhammer').transition).toBeNull();
    expect(onAir.activateScene('forge', blank).transition).toEqual(crossfade(2, null, 'forge'));
    expect(onAir.closeCampaign().transition).toBeNull();
  });
});

describe('what of a Scene goes on air', () => {
  const image = (id: string, contentHash: string): Media => ({
    id,
    campaignId: 'c1',
    kind: 'image',
    category: 'scenery',
    contentHash,
    originalName: id,
    name: id,
    extension: '.png',
    favourite: false,
  });
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const library = [image('m1', hashA), image('m2', hashB)];
  const centre = { x: 0.5, y: 0.5 };
  const scene: Scene = {
    id: 's1',
    campaignId: 'c1',
    name: 'Embuscade des cultistes',
    title: 'Le vieux moulin',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'cover', zoom: 1.5, focus: centre, visible: true },
      { id: 'b2', mediaId: 'm2', fit: 'contain', zoom: 1, focus: { x: 0, y: 1 }, visible: false },
      { id: 'b3', mediaId: 'gone', fit: 'cover', zoom: 1, focus: centre, visible: true },
      { id: 'b4', mediaId: 'm2', fit: 'contain', zoom: 1, focus: { x: 1, y: 0 }, visible: true },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm2',
        position: { x: 0.2, y: 0.8 },
        height: 0.5,
        visible: true,
        label: { text: 'Garde', visible: true },
      },
      {
        id: 'o2',
        mediaId: 'm1',
        position: { x: 0, y: 0 },
        height: 1,
        visible: false,
        label: { text: 'Assassin', visible: true },
      },
      {
        id: 'o3',
        mediaId: 'm1',
        position: centre,
        height: 0.3,
        visible: true,
        label: { text: 'Traître', visible: false },
      },
    ],
    music: [],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: notesFromPlainText('Notes privées'),
  };

  it('keeps only visible placements of known images, bottom to top, with their addresses', () => {
    expect(onAirSceneOf(scene, library)).toEqual({
      backgrounds: [
        {
          id: 'b1',
          src: `regie-media://media/c1/${hashA}.png`,
          fit: 'cover',
          zoom: 1.5,
          focus: centre,
        },
        {
          id: 'b4',
          src: `regie-media://media/c1/${hashB}.png`,
          fit: 'contain',
          zoom: 1,
          focus: { x: 1, y: 0 },
        },
      ],
      overlays: [
        {
          id: 'o1',
          src: `regie-media://media/c1/${hashB}.png`,
          position: { x: 0.2, y: 0.8 },
          height: 0.5,
          label: 'Garde',
        },
        { id: 'o3', src: `regie-media://media/c1/${hashA}.png`, position: centre, height: 0.3 },
      ],
      title: 'Le vieux moulin',
    });
  });

  it('never carries Hidden placements or Labels, the Scene name, notes or Media names', () => {
    const named = library.map((media) => ({ ...media, name: 'Nom du média' }));
    const json = JSON.stringify(onAirSceneOf(scene, named));
    for (const secret of [
      'Embuscade',
      'privées',
      'Nom du média',
      'Assassin',
      'Traître',
      'b2',
      'o2',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('carries no Scene title when it is empty', () => {
    expect(onAirSceneOf({ ...scene, title: '  ' }, library)).not.toHaveProperty('title');
  });

  it('carries no Label when its text is empty', () => {
    const blankLabel = {
      ...scene,
      overlays: [{ ...scene.overlays[0], label: { text: '', visible: true } }],
    };
    expect(onAirSceneOf(blankLabel, library).overlays[0]).not.toHaveProperty('label');
  });

  it('carries a Label only once both its Overlay and the Label are shown', () => {
    const bare: Scene = { ...scene, title: '', backgrounds: [], overlays: [] };
    const after = (...edits: SceneEdit[]) =>
      onAirSceneOf(
        edits.reduce((current, edit) => applySceneEdit(current, edit, () => 'o9'), bare),
        library,
      );
    const placed: SceneEdit = { kind: 'place-overlay', mediaId: 'm1' };
    const named: SceneEdit = { kind: 'set-label-text', overlayId: 'o9', text: 'Garde' };
    const shown: SceneEdit = { kind: 'set-visible', placementId: 'o9', visible: true };
    const labelShown: SceneEdit = { kind: 'set-label-visible', overlayId: 'o9', visible: true };
    expect(after(placed, named, labelShown).overlays).toEqual([]);
    expect(after(placed, named, shown).overlays).toEqual([
      expect.not.objectContaining({ label: expect.anything() }),
    ]);
    expect(after(placed, named, shown, labelShown).overlays).toEqual([
      expect.objectContaining({ id: 'o9', label: 'Garde' }),
    ]);
  });

  it('carries the Scene title once set, never the Scene name', () => {
    const untitled = { ...scene, title: '' };
    expect(onAirSceneOf(untitled, library)).not.toHaveProperty('title');
    const titled = applySceneEdit(untitled, { kind: 'set-title', title: 'Le moulin' }, () => '');
    expect(onAirSceneOf(titled, library)).toHaveProperty('title', 'Le moulin');
    expect(JSON.stringify(onAirSceneOf(titled, library))).not.toContain(scene.name);
  });
});

describe('what of a Scene the editor draws', () => {
  const image = (id: string, contentHash: string): Media => ({
    id,
    campaignId: 'c1',
    kind: 'image',
    category: 'scenery',
    contentHash,
    originalName: id,
    name: id,
    extension: '.png',
    favourite: false,
  });
  const hash = 'a'.repeat(64);
  const src = `regie-media://media/c1/${hash}.png`;
  const centre = { x: 0.5, y: 0.5 };
  const scene: Scene = {
    id: 's1',
    campaignId: 'c1',
    name: 'Embuscade des cultistes',
    title: 'Le vieux moulin',
    backgrounds: [
      { id: 'b1', mediaId: 'm1', fit: 'cover', zoom: 1, focus: centre, visible: true },
      { id: 'b2', mediaId: 'm1', fit: 'contain', zoom: 2, focus: centre, visible: false },
      { id: 'b3', mediaId: 'gone', fit: 'cover', zoom: 1, focus: centre, visible: true },
    ],
    overlays: [
      {
        id: 'o1',
        mediaId: 'm1',
        position: centre,
        height: 0.5,
        visible: false,
        label: { text: 'Garde', visible: false },
      },
      {
        id: 'o2',
        mediaId: 'm1',
        position: centre,
        height: 0.3,
        visible: true,
        label: { text: 'Traître', visible: true },
      },
      {
        id: 'o3',
        mediaId: 'm1',
        position: centre,
        height: 0.3,
        visible: true,
        label: { text: ' ', visible: true },
      },
    ],
    music: [],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: notesFromPlainText('Notes privées'),
  };

  it('draws every placement of a known image, marking Hidden ones and Hidden Labels', () => {
    expect(editorPictureOf(scene, [image('m1', hash)])).toEqual({
      backgrounds: [
        { id: 'b1', src, fit: 'cover', zoom: 1, focus: centre, hidden: false },
        { id: 'b2', src, fit: 'contain', zoom: 2, focus: centre, hidden: true },
      ],
      overlays: [
        {
          id: 'o1',
          src,
          position: centre,
          height: 0.5,
          hidden: true,
          label: 'Garde',
          labelHidden: true,
        },
        {
          id: 'o2',
          src,
          position: centre,
          height: 0.3,
          hidden: false,
          label: 'Traître',
          labelHidden: false,
        },
        { id: 'o3', src, position: centre, height: 0.3, hidden: false },
      ],
      title: 'Le vieux moulin',
    });
  });

  it('draws no Scene title when it is empty', () => {
    expect(editorPictureOf({ ...scene, title: '' }, [])).not.toHaveProperty('title');
  });
});

describe('the snapshot a window shows', () => {
  const v1 = {
    campaignId: 'star-wars',
    activeSceneId: null,
    scene: null,
    blackout: false,
    fadeDurationMs: 600,
    transition: null,
    version: 1,
  };
  const v2 = { ...v1, activeSceneId: 'cantina', version: 2 };

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
