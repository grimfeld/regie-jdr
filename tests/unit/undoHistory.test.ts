import { describe, expect, it } from 'vitest';
import type { SceneHistoryEdit } from '../../shared/contract';
import type { Scene } from '../../shared/domain';
import { UNDO_DEPTH, createUndoHistories, undoLabel } from '../../core/undoHistory';
import { emptyNotes } from '../../core/notes';

function scene(id: string, name = id, campaignId = 'c1'): Scene {
  return {
    id,
    campaignId,
    name,
    title: '',
    backgrounds: [],
    overlays: [],
    music: [],
    ambiences: [],
    volumes: { music: 1, ambience: 1 },
    notes: emptyNotes(),
  };
}

const withOrc: Scene = {
  ...scene('s1'),
  backgrounds: [
    { id: 'bg', mediaId: 'm-map', fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 }, visible: true },
  ],
  overlays: [
    {
      id: 'ov',
      mediaId: 'm-orc',
      position: { x: 0.5, y: 0.5 },
      height: 0.5,
      visible: true,
      label: { text: 'Orc', visible: false },
    },
  ],
};

const names: Record<string, string> = { 'm-map': 'Port', 'm-orc': 'Orc' };
const mediaName = (id: string) => names[id];

describe('undo histories', () => {
  function setup() {
    return { histories: createUndoHistories() };
  }

  it('undoes then redoes a recorded edit, naming it on both buttons', () => {
    const { histories } = setup();
    const before = scene('s1', 'Cantina');
    const after = scene('s1', 'Cantina de Mos Eisley');
    histories.record({ before, after, label: 'renommer la scène' });
    expect(histories.state('c1', 's1')).toEqual({ undo: 'renommer la scène', redo: null });

    const undo = histories.nextUndo('c1', 's1');
    expect(undo).toEqual({ expected: after, restore: before });
    histories.undone('c1', 's1');
    expect(histories.state('c1', 's1')).toEqual({ undo: null, redo: 'renommer la scène' });

    expect(histories.nextRedo('c1', 's1')).toEqual({ expected: before, restore: after });
    histories.redone('c1', 's1');
    expect(histories.state('c1', 's1')).toEqual({ undo: 'renommer la scène', redo: null });
  });

  it('has nothing to undo or redo for a Scene never edited', () => {
    const { histories } = setup();
    expect(histories.state('c1', 's1')).toEqual({ undo: null, redo: null });
    expect(histories.nextUndo('c1', 's1')).toBeUndefined();
    expect(histories.nextRedo('c1', 's1')).toBeUndefined();
  });

  it('keeps one history per Scene', () => {
    const { histories } = setup();
    histories.record({ before: scene('s1'), after: scene('s1', 'A'), label: 'un' });
    histories.record({ before: scene('s2'), after: scene('s2', 'B'), label: 'deux' });
    expect(histories.state('c1', 's1').undo).toBe('un');
    expect(histories.state('c1', 's2').undo).toBe('deux');
    expect(histories.state('c2', 's1').undo).toBeNull();
  });

  it('keeps the last 100 steps of a Scene', () => {
    const { histories } = setup();
    for (let i = 0; i < UNDO_DEPTH + 5; i++) {
      histories.record({
        before: scene('s1', `n${i}`),
        after: scene('s1', `n${i + 1}`),
        label: `${i}`,
      });
    }
    let undone = 0;
    while (histories.nextUndo('c1', 's1')) {
      histories.undone('c1', 's1');
      undone++;
    }
    expect(undone).toBe(UNDO_DEPTH);
    expect(histories.state('c1', 's1').redo).toBe('5');
  });

  it('forgets what could be redone once a new edit is recorded', () => {
    const { histories } = setup();
    histories.record({ before: scene('s1'), after: scene('s1', 'A'), label: 'un' });
    histories.undone('c1', 's1');
    histories.record({ before: scene('s1'), after: scene('s1', 'B'), label: 'deux' });
    expect(histories.state('c1', 's1')).toEqual({ undo: 'deux', redo: null });
  });

  it('records nothing for an edit that changed nothing', () => {
    const { histories } = setup();
    histories.record({ before: withOrc, after: structuredClone(withOrc), label: 'afficher Orc' });
    expect(histories.state('c1', 's1').undo).toBeNull();
  });

  it('keeps each recorded edit as its own step, however quick', () => {
    const { histories } = setup();
    const named = (n: number) => scene('s1', `n${n}`);
    histories.record({ before: named(0), after: named(1), label: 'déplacer Orc' });
    histories.record({ before: named(1), after: named(2), label: 'redimensionner Orc' });
    expect(histories.nextUndo('c1', 's1')).toEqual({ expected: named(2), restore: named(1) });
    histories.undone('c1', 's1');
    expect(histories.nextUndo('c1', 's1')).toEqual({ expected: named(1), restore: named(0) });
  });

  it('clears one Scene, or every Scene (Campaign switch)', () => {
    const { histories } = setup();
    histories.record({ before: scene('s1'), after: scene('s1', 'A'), label: 'un' });
    histories.record({ before: scene('s2'), after: scene('s2', 'B'), label: 'deux' });
    histories.clear('c1', 's1');
    expect(histories.state('c1', 's1').undo).toBeNull();
    expect(histories.state('c1', 's2').undo).toBe('deux');
    histories.clearAll();
    expect(histories.state('c1', 's2').undo).toBeNull();
  });
});

describe('undo labels', () => {
  const cases: [SceneHistoryEdit, string][] = [
    [{ kind: 'place-background', mediaId: 'm-map' }, 'placer Port en arrière-plan'],
    [{ kind: 'place-overlay', mediaId: 'm-orc' }, 'placer Orc en superposition'],
    [{ kind: 'set-visible', placementId: 'ov', visible: false }, 'masquer Orc'],
    [{ kind: 'set-visible', placementId: 'bg', visible: true }, 'afficher Port'],
    [{ kind: 'remove-placement', placementId: 'ov' }, 'retirer Orc'],
    [{ kind: 'move-background', placementId: 'bg', toIndex: 0 }, 'réordonner Port'],
    [{ kind: 'move-overlay', placementId: 'ov', toIndex: 0 }, 'réordonner Orc'],
    [{ kind: 'set-background-fit', placementId: 'bg', fit: 'contain' }, 'régler Port sur Contenir'],
    [{ kind: 'set-background-fit', placementId: 'bg', fit: 'cover' }, 'régler Port sur Couvrir'],
    [{ kind: 'frame-background', placementId: 'bg', zoom: 2 }, 'cadrer Port'],
    [{ kind: 'transform-overlay', placementId: 'ov', position: { x: 0.2 } }, 'déplacer Orc'],
    [{ kind: 'transform-overlay', placementId: 'ov', height: 0.3 }, 'redimensionner Orc'],
    [{ kind: 'rename', name: 'Hangar' }, 'renommer la scène'],
    [{ kind: 'set-title', title: 'Le vieux moulin' }, 'modifier le titre affiché'],
    [{ kind: 'set-label-text', overlayId: 'ov', text: 'Chef orc' }, 'étiqueter Orc'],
    [{ kind: 'set-label-text', overlayId: 'ov', text: ' ' }, 'retirer l’étiquette (Orc)'],
    [{ kind: 'set-label-visible', overlayId: 'ov', visible: true }, 'afficher l’étiquette (Orc)'],
    [{ kind: 'set-label-visible', overlayId: 'ov', visible: false }, 'masquer l’étiquette (Orc)'],
    [{ kind: 'add-music', mediaId: 'm-map' }, 'ajouter la musique Port'],
    [{ kind: 'add-music', mediaId: 'unknown' }, 'ajouter la musique'],
    [{ kind: 'add-ambience', mediaId: 'm-map' }, 'ajouter l’ambiance Port'],
    [{ kind: 'add-ambience', mediaId: 'unknown' }, 'ajouter l’ambiance'],
    [{ kind: 'remove-ambience', mediaId: 'm-map' }, 'retirer l’ambiance Port'],
    [{ kind: 'set-ambience-on', mediaId: 'm-map', on: true }, 'allumer l’ambiance Port'],
    [{ kind: 'set-ambience-on', mediaId: 'm-map', on: false }, 'éteindre l’ambiance Port'],
    [
      { kind: 'set-ambience-volume', mediaId: 'm-map', volume: 0.5 },
      'régler le volume de l’ambiance Port',
    ],
    [{ kind: 'set-ambience-level', level: 0.5 }, 'régler le niveau des ambiances'],
    [{ kind: 'move-music', mediaId: 'm-map', toIndex: 0 }, 'réordonner la musique Port'],
    [{ kind: 'remove-music', mediaId: 'm-map' }, 'retirer la musique Port'],
    [{ kind: 'set-music-level', level: 0.5 }, 'régler le niveau des musiques'],
  ];

  it.each(cases)('names %j "%s"', (edit, label) => {
    expect(undoLabel(withOrc, edit, mediaName)).toBe(label);
  });

  it('names a placement whose Media is unknown "l’image"', () => {
    expect(
      undoLabel(withOrc, { kind: 'remove-placement', placementId: 'ov' }, () => undefined),
    ).toBe('retirer l’image');
  });
});
