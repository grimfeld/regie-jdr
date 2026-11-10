import { describe, expect, it } from 'vitest';
import { addBackground, setBackgroundVisible } from '../../core/sceneEdits';
import type { Scene } from '../../shared/domain';

const empty: Scene = {
  id: 's1',
  campaignId: 'c1',
  name: 'La cantina',
  backgrounds: [],
  overlays: [],
  music: [],
  ambiences: [],
  volumes: { music: 1, ambience: 1 },
  notes: '',
};

describe('Scene edits', () => {
  it('adds a Background on top of the stack, Hidden, covering the canvas', () => {
    const one = addBackground(empty, 'm1', 'b1');
    const two = addBackground(one, 'm2', 'b2');
    expect(two.backgrounds).toEqual([
      { id: 'b1', mediaId: 'm1', fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: false },
      { id: 'b2', mediaId: 'm2', fit: 'cover', position: { x: 0.5, y: 0.5 }, visible: false },
    ]);
    expect(empty.backgrounds).toEqual([]);
  });

  it('shows and hides one Background, leaving the others', () => {
    const scene = addBackground(addBackground(empty, 'm1', 'b1'), 'm2', 'b2');
    const shown = setBackgroundVisible(scene, 'b2', true);
    expect(shown.backgrounds.map((b) => b.visible)).toEqual([false, true]);
    expect(setBackgroundVisible(shown, 'b2', false).backgrounds.map((b) => b.visible)).toEqual([
      false,
      false,
    ]);
  });
});
