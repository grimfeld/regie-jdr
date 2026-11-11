import { describe, expect, it } from 'vitest';
import type { SceneEdit } from '../../shared/contract';
import type { Scene } from '../../shared/domain';
import {
  MERGE_WINDOW_MS,
  UNDO_DEPTH,
  createUndoHistories,
  mergeKeyOf,
  undoLabel,
} from '../../core/undoHistory';

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
    notes: '',
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
    let time = 0;
    const histories = createUndoHistories({ now: () => time });
    return {
      histories,
      advance: (ms: number) => {
        time += ms;
      },
    };
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

  it('merges quick successive edits with the same merge key into one step', () => {
    const { histories, advance } = setup();
    const at = (x: number): Scene => ({
      ...withOrc,
      overlays: withOrc.overlays.map((item) => ({ ...item, position: { x, y: 0.5 } })),
    });
    histories.record({ before: at(0.5), after: at(0.6), label: 'déplacer Orc', mergeKey: 'k' });
    advance(MERGE_WINDOW_MS);
    histories.record({ before: at(0.6), after: at(0.7), label: 'déplacer Orc', mergeKey: 'k' });
    expect(histories.nextUndo('c1', 's1')).toEqual({ expected: at(0.7), restore: at(0.5) });
    histories.undone('c1', 's1');
    expect(histories.nextUndo('c1', 's1')).toBeUndefined();
  });

  it('does not merge edits apart in time, with other keys, or after an undo', () => {
    const { histories, advance } = setup();
    const named = (n: number) => scene('s1', `n${n}`);
    histories.record({ before: named(0), after: named(1), label: 'a', mergeKey: 'k' });
    advance(MERGE_WINDOW_MS + 1);
    histories.record({ before: named(1), after: named(2), label: 'b', mergeKey: 'k' });
    histories.record({ before: named(2), after: named(3), label: 'c', mergeKey: 'other' });
    histories.record({ before: named(3), after: named(4), label: 'd' });
    histories.record({ before: named(4), after: named(5), label: 'e' });
    histories.undone('c1', 's1');
    histories.record({ before: named(4), after: named(6), label: 'f', mergeKey: 'k' });
    histories.record({ before: named(6), after: named(7), label: 'g', mergeKey: 'k' });

    const labels: string[] = [];
    let state = histories.state('c1', 's1');
    while (state.undo !== null) {
      labels.push(state.undo);
      histories.undone('c1', 's1');
      state = histories.state('c1', 's1');
    }
    expect(labels).toEqual(['g', 'd', 'c', 'b', 'a']);
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

describe('merge keys', () => {
  it('lets moves and resizes of one Overlay merge, and nothing else', () => {
    const move: SceneEdit = { kind: 'transform-overlay', placementId: 'ov', position: { x: 0.1 } };
    expect(mergeKeyOf(move)).toBe(mergeKeyOf({ ...move, height: 0.4 }));
    expect(mergeKeyOf(move)).not.toBe(mergeKeyOf({ ...move, placementId: 'other' }));
    expect(mergeKeyOf({ kind: 'set-visible', placementId: 'ov', visible: false })).toBeUndefined();
  });
});

describe('undo labels', () => {
  const cases: [SceneEdit, string][] = [
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
